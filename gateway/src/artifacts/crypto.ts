/**
 * artifacts/crypto.ts — link-bound encryption for stored share artifacts.
 *
 * The share token (32 random bytes, base64url) is the only thing that can
 * decrypt a stored artifact. It exists only in the share URL; the server
 * keeps SHA-256(token) for lookup and never the token itself. So a copy of
 * Postgres, the R2 bucket or a backup reveals no artifact without its link.
 *
 * Per publication, at the first write that has the token in hand (publish,
 * or the first view of a row stored before encryption existed):
 *   - an X25519 key pair is generated;
 *   - the public key is stored as is (encPublicKey);
 *   - the private key is sealed with AES-256-GCM under a key-encryption key
 *     derived from the token, HKDF-SHA256(token, salt = publication id), and
 *     stored (encWrappedKey).
 * Every artifact write seals the HTML to the public key: an ephemeral X25519
 * key agreement, HKDF to a one-time AES-256-GCM key. Re-publish carries no
 * token (the desktop addresses it by publication id), which is why the
 * scheme is asymmetric: the server can encrypt a new revision but cannot
 * read any revision. Serving (GET /s/:token) re-derives the wrapping key
 * from the presented token, unwraps the private key and opens the envelope.
 *
 * Revocation deletes the wrapped key, which makes every copy of the
 * ciphertext unreadable (crypto-shredding), including one a failed R2
 * delete leaves behind.
 *
 * Envelope (bytes): version (1) | ephemeral public key (32) | IV (12) |
 * GCM tag (16) | ciphertext. Wrapped key (base64url): IV (12) | tag (16) |
 * sealed private key (32). Both bind the publication id as associated data,
 * so neither can be moved to another row.
 */
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto'

const ENVELOPE_V1 = 0x01
const X25519_LEN = 32
const IV_LEN = 12
const TAG_LEN = 16
const ENVELOPE_HEADER_LEN = 1 + X25519_LEN + IV_LEN + TAG_LEN

export interface ArtifactKeys {
  /** X25519 public key, raw 32 bytes, base64url. */
  encPublicKey: string
  /** The private key sealed under the token-derived key, base64url. */
  encWrappedKey: string
}

function hkdf(ikm: Buffer, salt: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, 32))
}

function wrappingKey(token: string, publicationId: string): Buffer {
  return hkdf(Buffer.from(token, 'utf-8'), Buffer.from(publicationId, 'utf-8'), 'prose-share-kek-v1')
}

function seal(key: Buffer, plaintext: Buffer, aad: Buffer): { iv: Buffer; tag: Buffer; ciphertext: Buffer } {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { iv, tag: cipher.getAuthTag(), ciphertext }
}

function open(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function publicKeyFrom(x: string): KeyObject {
  return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x }, format: 'jwk' })
}

const kekAad = (publicationId: string, encPublicKey: string) =>
  Buffer.from(`prose-share-kek-v1:${publicationId}:${encPublicKey}`, 'utf-8')
const artifactAad = (publicationId: string) => Buffer.from(`prose-share-artifact-v1:${publicationId}`, 'utf-8')

function artifactKey(shared: Buffer, ephemeral: Buffer, recipient: Buffer): Buffer {
  return hkdf(shared, Buffer.concat([ephemeral, recipient]), 'prose-share-artifact-v1')
}

/** A fresh key pair for a publication, its private half sealed to `token`. */
export function createArtifactKeys(token: string, publicationId: string): ArtifactKeys {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const encPublicKey = publicKey.export({ format: 'jwk' }).x as string
  const d = Buffer.from(privateKey.export({ format: 'jwk' }).d as string, 'base64url')
  const { iv, tag, ciphertext } = seal(wrappingKey(token, publicationId), d, kekAad(publicationId, encPublicKey))
  return { encPublicKey, encWrappedKey: Buffer.concat([iv, tag, ciphertext]).toString('base64url') }
}

/** Seal artifact HTML to a publication's public key. Needs no token. */
export function sealArtifact(html: string, encPublicKey: string, publicationId: string): Buffer {
  const recipient = publicKeyFrom(encPublicKey)
  const ephemeral = generateKeyPairSync('x25519')
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient })
  const epk = Buffer.from(ephemeral.publicKey.export({ format: 'jwk' }).x as string, 'base64url')
  const key = artifactKey(shared, epk, Buffer.from(encPublicKey, 'base64url'))
  const { iv, tag, ciphertext } = seal(key, Buffer.from(html, 'utf-8'), artifactAad(publicationId))
  return Buffer.concat([Buffer.from([ENVELOPE_V1]), epk, iv, tag, ciphertext])
}

/**
 * Open a sealed artifact with the share token. Throws when the token, the
 * keys or the envelope don't match: GCM authenticates all three.
 */
export function openArtifact(
  envelope: Uint8Array,
  token: string,
  publicationId: string,
  keys: ArtifactKeys
): string {
  const env = Buffer.from(envelope)
  if (env.length < ENVELOPE_HEADER_LEN || env[0] !== ENVELOPE_V1) {
    throw new Error('artifact envelope: unknown format')
  }
  const wrapped = Buffer.from(keys.encWrappedKey, 'base64url')
  const d = open(
    wrappingKey(token, publicationId),
    wrapped.subarray(0, IV_LEN),
    wrapped.subarray(IV_LEN, IV_LEN + TAG_LEN),
    wrapped.subarray(IV_LEN + TAG_LEN),
    kekAad(publicationId, keys.encPublicKey)
  )
  const privateKey = createPrivateKey({
    key: { kty: 'OKP', crv: 'X25519', x: keys.encPublicKey, d: d.toString('base64url') },
    format: 'jwk',
  })
  const epk = env.subarray(1, 1 + X25519_LEN)
  const shared = diffieHellman({ privateKey, publicKey: publicKeyFrom(epk.toString('base64url')) })
  const key = artifactKey(shared, epk, Buffer.from(keys.encPublicKey, 'base64url'))
  let at = 1 + X25519_LEN
  const iv = env.subarray(at, (at += IV_LEN))
  const tag = env.subarray(at, (at += TAG_LEN))
  return open(key, iv, tag, env.subarray(at), artifactAad(publicationId)).toString('utf-8')
}
