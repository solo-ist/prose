/**
 * artifacts/index.ts — storage for published share artifacts (#768).
 *
 * The infra decision (web-platform.md §7) puts flat-HTML share snapshots in
 * R2. When R2 is unconfigured (local dev, single-user beta before the bucket
 * is provisioned), the artifact falls back to the `artifactHtml` column on
 * the Publication row — Postgres already holds text fine at beta scale, and
 * Render has no disks. Each Publication records which store holds it
 * (`storage: 'r2' | 'db'`), so provisioning R2 later never strands old rows.
 */
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2, r2Configured } from '../r2/index.js'
import { config } from '../config.js'
import { prisma } from '../db/index.js'

function requireBucket(): string {
  if (!config.R2_BUCKET) throw new Error('R2_BUCKET not configured')
  return config.R2_BUCKET
}

/** Store artifact HTML; returns the storage fields to persist on the row. */
export async function putArtifact(
  publicationId: string,
  html: string
): Promise<{ storage: 'r2' | 'db'; r2Key: string | null; artifactHtml: string | null }> {
  if (r2Configured && r2) {
    const key = `shares/${publicationId}/artifact.html`
    await r2.send(
      new PutObjectCommand({
        Bucket: requireBucket(),
        Key: key,
        Body: html,
        ContentType: 'text/html; charset=utf-8',
      })
    )
    return { storage: 'r2', r2Key: key, artifactHtml: null }
  }
  return { storage: 'db', r2Key: null, artifactHtml: html }
}

/** Load artifact HTML for a publication row; null when missing/deleted. */
export async function getArtifact(pub: {
  id: string
  storage: string
  r2Key: string | null
  artifactHtml: string | null
}): Promise<string | null> {
  if (pub.storage === 'r2' && pub.r2Key && r2) {
    const res = await r2.send(
      new GetObjectCommand({ Bucket: requireBucket(), Key: pub.r2Key })
    )
    return (await res.Body?.transformToString('utf-8')) ?? null
  }
  return pub.artifactHtml
}

/** Delete the stored artifact (revocation). Clears both stores. */
export async function deleteArtifact(pub: {
  id: string
  storage: string
  r2Key: string | null
}): Promise<void> {
  // Clear r2Key only after the object is actually gone. If the R2 client is
  // unconfigured at revoke time (config drift between publish and revoke),
  // nulling the key would orphan the bytes in the bucket with no way to ever
  // find them again — keep the pointer so a later cleanup can. (Addendum
  // review: revoked bytes must not outlive the share unfindably.)
  let r2Deleted = true
  if (pub.storage === 'r2' && pub.r2Key) {
    if (r2) {
      await r2.send(new DeleteObjectCommand({ Bucket: requireBucket(), Key: pub.r2Key }))
    } else {
      r2Deleted = false
      console.warn(
        `[share] revoke ${pub.id}: R2 client unconfigured — object ${pub.r2Key} left in bucket, key retained for later cleanup`
      )
    }
  }
  await prisma.publication.update({
    where: { id: pub.id },
    data: { artifactHtml: null, ...(r2Deleted ? { r2Key: null } : {}) },
  })
}
