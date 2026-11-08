/**
 * artifacts/index.ts — storage for published share artifacts (#768).
 *
 * The infra decision (web-platform.md §7) puts flat-HTML share snapshots in
 * R2. When R2 is unconfigured (local dev, single-user beta before the bucket
 * is provisioned), the artifact falls back to the Publication row — Postgres
 * already holds it fine at beta scale, and Render has no disks. Each
 * Publication records which store holds it (`storage: 'r2' | 'db'`), so
 * provisioning R2 later never strands old rows.
 *
 * Stored artifacts are sealed to the share link (artifacts/crypto.ts): R2
 * and the `artifactCipher` column hold ciphertext only. A row published
 * before encryption keeps its plaintext (R2 object or `artifactHtml`) until
 * its first view, when the serve route seals it (sealLegacyArtifact).
 *
 * Every R2 write goes to a fresh object key, and the writer deletes the
 * object the row pointed to before only after the row points at the new one.
 * Two writers can then never overwrite each other's bytes under a row that
 * still points at them; a writer that loses a race leaves at most an
 * orphaned object, sealed to keys the row no longer holds.
 */
import { randomBytes } from 'node:crypto'
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2, r2Configured } from '../r2/index.js'
import { config } from '../config.js'
import { prisma } from '../db/index.js'
import { createArtifactKeys, openArtifact, sealArtifact } from './crypto.js'

/**
 * Thrown by getArtifact when the publication row was written to R2 but the
 * R2 client is unavailable now (config drift between the publish and the
 * serve). Callers should surface this as a 503 — not a 404, which would
 * mislead the viewer into thinking the content is gone when it is only
 * temporarily unreachable.
 */
export class R2UnavailableError extends Error {
  readonly publicationId: string
  constructor(publicationId: string) {
    super(`artifact ${publicationId}: storage=r2 but the R2 client is unconfigured`)
    this.name = 'R2UnavailableError'
    this.publicationId = publicationId
  }
}

/** The storage fields of a Publication row. */
export interface StoredArtifact {
  id: string
  storage: string
  r2Key: string | null
  artifactHtml: string | null
  artifactCipher: Uint8Array | null
  encPublicKey: string | null
  encWrappedKey: string | null
}

interface StorageFields {
  storage: 'r2' | 'db'
  r2Key: string | null
  artifactHtml: string | null
  artifactCipher: Uint8Array<ArrayBuffer> | null
}

function requireBucket(): string {
  if (!config.R2_BUCKET) throw new Error('R2_BUCKET not configured')
  return config.R2_BUCKET
}

/** True when the row's stored artifact is sealed to its link. */
export function isSealed(pub: Pick<StoredArtifact, 'encPublicKey' | 'encWrappedKey'>): boolean {
  return Boolean(pub.encPublicKey && pub.encWrappedKey)
}

/**
 * Store artifact HTML; returns the storage fields to persist on the row.
 * With the publication's public key the stored bytes are sealed. Without
 * one (a row from before encryption, re-published before its first view)
 * they are plaintext, as before; the next view seals them.
 */
export async function putArtifact(
  publicationId: string,
  html: string,
  encPublicKey: string | null
): Promise<StorageFields> {
  const sealed = encPublicKey ? sealArtifact(html, encPublicKey, publicationId) : null
  if (r2Configured && r2) {
    const key = `shares/${publicationId}/${randomBytes(8).toString('hex')}.${sealed ? 'enc' : 'html'}`
    await r2.send(
      new PutObjectCommand({
        Bucket: requireBucket(),
        Key: key,
        Body: sealed ?? html,
        ContentType: sealed ? 'application/octet-stream' : 'text/html; charset=utf-8',
      })
    )
    return { storage: 'r2', r2Key: key, artifactHtml: null, artifactCipher: null }
  }
  return sealed
    ? { storage: 'db', r2Key: null, artifactHtml: null, artifactCipher: new Uint8Array(sealed) }
    : { storage: 'db', r2Key: null, artifactHtml: html, artifactCipher: null }
}

/**
 * Delete an R2 object no row points at: the revision a write replaced, or a
 * writer's own copy after it lost a race. Best-effort: a failure leaves an
 * orphan, never a broken row.
 */
export async function discardObject(key: string | null): Promise<void> {
  if (!r2 || !key) return
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: requireBucket(), Key: key }))
  } catch (err) {
    console.error(`[artifacts] could not delete a replaced object (orphaned)`, err)
  }
}

/** Load artifact HTML for a publication row; null when missing/deleted.
 *
 * `token` is the share token from the request URL; a sealed artifact opens
 * only with it. Throws when it doesn't match (GCM authenticates the token,
 * the keys and the bytes).
 *
 * Throws R2UnavailableError when the row records storage=r2 but the R2
 * client is unconfigured. Callers must catch that and serve a 503 — a
 * silent null here would produce a misleading 404 for content that exists
 * but is temporarily unreachable (config drift between publish and serve).
 */
export async function getArtifact(pub: StoredArtifact, token: string): Promise<string | null> {
  const sealed = isSealed(pub)
  if (pub.storage === 'r2' && pub.r2Key) {
    if (!r2) {
      console.error(
        `[artifacts] getArtifact ${pub.id}: storage=r2 but R2 client is unconfigured — serving 503`,
      )
      throw new R2UnavailableError(pub.id)
    }
    const res = await r2.send(
      new GetObjectCommand({ Bucket: requireBucket(), Key: pub.r2Key })
    )
    if (!res.Body) return null
    if (!sealed) return res.Body.transformToString('utf-8')
    return openArtifact(await res.Body.transformToByteArray(), token, pub.id, {
      encPublicKey: pub.encPublicKey as string,
      encWrappedKey: pub.encWrappedKey as string,
    })
  }
  if (!sealed) return pub.artifactHtml
  if (!pub.artifactCipher) return null
  return openArtifact(pub.artifactCipher, token, pub.id, {
    encPublicKey: pub.encPublicKey as string,
    encWrappedKey: pub.encWrappedKey as string,
  })
}

/**
 * Seal a row stored before encryption existed, on its first view: the only
 * moment the server holds its token. Conditional on the row being unchanged
 * since `pub` was read, so a re-publish or revoke in between wins and this
 * copy is discarded. Returns whether the row is now sealed.
 */
export async function sealLegacyArtifact(
  pub: StoredArtifact & { revCount: number },
  token: string,
  html: string
): Promise<boolean> {
  const keys = createArtifactKeys(token, pub.id)
  const stored = await putArtifact(pub.id, html, keys.encPublicKey)
  const { count } = await prisma.publication.updateMany({
    where: { id: pub.id, revCount: pub.revCount, encPublicKey: null, revokedAt: null },
    data: { ...stored, ...keys },
  })
  if (count === 0) {
    await discardObject(stored.r2Key)
    return false
  }
  await discardObject(pub.storage === 'r2' ? pub.r2Key : null)
  return true
}

/** How many live rows still hold a plaintext artifact (boot audit). */
export function countUnsealedArtifacts(): Promise<number> {
  return prisma.publication.count({
    where: {
      revokedAt: null,
      encPublicKey: null,
      OR: [{ artifactHtml: { not: null } }, { r2Key: { not: null } }],
    },
  })
}

/** Delete the stored artifact (revocation). Clears both stores. */
export async function deleteArtifact(pub: Pick<StoredArtifact, 'id' | 'storage' | 'r2Key'>): Promise<void> {
  // Shred first. With the wrapped key gone, no copy of the ciphertext can be
  // opened again, including one a failed R2 delete below leaves behind.
  await prisma.publication.update({
    where: { id: pub.id },
    data: { artifactHtml: null, artifactCipher: null, encPublicKey: null, encWrappedKey: null },
  })
  // Clear r2Key only after the object is actually gone. If the R2 client is
  // unconfigured at revoke time (config drift between publish and revoke),
  // nulling the key would orphan the bytes in the bucket with no way to ever
  // find them again — keep the pointer so a later cleanup can. (Addendum
  // review: revoked bytes must not outlive the share unfindably.)
  if (pub.storage === 'r2' && pub.r2Key) {
    if (!r2) {
      console.warn(
        `[share] revoke ${pub.id}: R2 client unconfigured — object ${pub.r2Key} left in bucket, key retained for later cleanup`
      )
      return
    }
    await r2.send(new DeleteObjectCommand({ Bucket: requireBucket(), Key: pub.r2Key }))
    await prisma.publication.update({ where: { id: pub.id }, data: { r2Key: null } })
  }
}
