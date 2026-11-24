/**
 * test-artifact-crypto.ts — unit checks for link-bound artifact encryption
 * (src/artifacts/crypto.ts). No database or server: pure functions.
 *
 * Usage: npm run test:crypto
 */
import { randomBytes } from 'node:crypto'
import { createArtifactKeys, openArtifact, sealArtifact } from '../src/artifacts/crypto.js'

let passed = 0
let failed = 0
const expect = (cond: boolean, label: string) => {
  if (cond) { console.log(`  ✓ ${label}`); passed++ } else { console.error(`  ✗ ${label}`); failed++ }
}
const throws = (fn: () => unknown) => { try { fn(); return false } catch { return true } }

const token = randomBytes(32).toString('base64url')
const otherToken = randomBytes(32).toString('base64url')
const pubId = '6f1c2b8e-0d1a-4c3b-9a7e-2f4d5c6b7a81'
const otherPubId = '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b'
const html = `<!DOCTYPE html><p>secret body ${randomBytes(8).toString('hex')} — ünïcödé</p>`

const keys = createArtifactKeys(token, pubId)
const envelope = sealArtifact(html, keys.encPublicKey, pubId)

expect(openArtifact(envelope, token, pubId, keys) === html, 'round trip with the right token')
expect(!envelope.includes(Buffer.from('secret body')), 'envelope holds no plaintext')
expect(!sealArtifact(html, keys.encPublicKey, pubId).equals(envelope), 'each seal is fresh (ephemeral key, random IV)')
expect(Buffer.from(keys.encWrappedKey, 'base64url').length === 60, 'wrapped key is IV + tag + sealed 32-byte key')
expect(throws(() => openArtifact(envelope, otherToken, pubId, keys)), 'another token cannot open it')
expect(throws(() => openArtifact(envelope, token, otherPubId, keys)), 'bound to its publication id')

const otherKeys = createArtifactKeys(token, pubId)
expect(throws(() => openArtifact(envelope, token, pubId, otherKeys)), 'keys of another key pair cannot open it')
expect(
  throws(() => openArtifact(envelope, token, pubId, { ...keys, encWrappedKey: otherKeys.encWrappedKey })),
  'a wrapped key cannot be paired with another public key'
)

const tampered = Buffer.from(envelope)
tampered[tampered.length - 1] ^= 0x01
expect(throws(() => openArtifact(tampered, token, pubId, keys)), 'a flipped ciphertext bit fails authentication')
const badVersion = Buffer.from(envelope)
badVersion[0] = 0x02
expect(throws(() => openArtifact(badVersion, token, pubId, keys)), 'an unknown envelope version is refused')
expect(throws(() => openArtifact(envelope.subarray(0, 40), token, pubId, keys)), 'a truncated envelope is refused')

const big = 'x'.repeat(8 * 1024 * 1024)
expect(openArtifact(sealArtifact(big, keys.encPublicKey, pubId), token, pubId, keys) === big, '8 MiB artifact round trip')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
