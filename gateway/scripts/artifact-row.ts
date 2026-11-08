/**
 * artifact-row.ts — test helper used by test-share.mjs and test-share-r2.mjs
 * to look at, and rewind, a publication's stored artifact.
 *
 *   inspect <publicationId> <marker>
 *     Prints the row's storage fields as JSON, plus whether the stored bytes
 *     (the DB columns; the R2 object is checked by the suite's mock) contain
 *     <marker> in the clear.
 *   make-legacy <publicationId> db <base64 html>
 *   make-legacy <publicationId> r2 <r2Key>
 *     Rewrites the row into its pre-encryption shape: no keys, plaintext in
 *     artifactHtml (db) or pointing at a plaintext object the suite put in
 *     the mock bucket (r2).
 *
 * Usage: npx tsx scripts/artifact-row.ts <command> ...
 */
import { prisma } from '../src/db/index.js'

// scripts/ ships in the gateway image (for the entitlement jobs), so this
// row-rewriting helper must refuse to run against production.
if (process.env.NODE_ENV === 'production') {
  console.error('artifact-row.ts is a test helper; refusing to run with NODE_ENV=production')
  process.exit(1)
}

const [, , command, pubId, arg1, arg2] = process.argv

if (command === 'inspect' && pubId && arg1) {
  const row = await prisma.publication.findUniqueOrThrow({ where: { id: pubId } })
  const marker = Buffer.from(arg1, 'utf-8')
  console.log(
    JSON.stringify({
      storage: row.storage,
      r2Key: row.r2Key,
      encPublicKey: row.encPublicKey,
      hasWrappedKey: row.encWrappedKey !== null,
      hasHtml: row.artifactHtml !== null,
      hasCipher: row.artifactCipher !== null,
      clearMarker:
        (row.artifactHtml ?? '').includes(arg1) ||
        (row.artifactCipher ? Buffer.from(row.artifactCipher).includes(marker) : false),
    })
  )
} else if (command === 'make-legacy' && pubId && (arg1 === 'db' || arg1 === 'r2') && arg2) {
  await prisma.publication.update({
    where: { id: pubId },
    data: {
      storage: arg1,
      r2Key: arg1 === 'r2' ? arg2 : null,
      artifactHtml: arg1 === 'db' ? Buffer.from(arg2, 'base64').toString('utf-8') : null,
      artifactCipher: null,
      encPublicKey: null,
      encWrappedKey: null,
    },
  })
  console.log(`[test] ${pubId} → pre-encryption shape (${arg1})`)
} else {
  console.error('usage: artifact-row.ts inspect <pubId> <marker> | make-legacy <pubId> db <base64html> | make-legacy <pubId> r2 <key>')
  process.exit(1)
}

await prisma.$disconnect()
