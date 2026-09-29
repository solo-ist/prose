/**
 * force-r2-storage.ts — test helper used by test-share.mjs.
 *
 * Mutates a publication row to storage='r2' with a plausible r2Key,
 * simulating a row published when R2 was configured, now served on an
 * instance with R2 unset. This lets test-share.mjs assert that the serve
 * route returns 503 (not 404) for such a row.
 *
 * Usage: npx tsx scripts/force-r2-storage.ts <publicationId>
 */
import { prisma } from '../src/db/index.js'

// scripts/ ships in the gateway image (for the entitlement jobs), so this
// row-rewriting helper must refuse to run against production.
if (process.env.NODE_ENV === 'production') {
  console.error('force-r2-storage.ts is a test helper; refusing to run with NODE_ENV=production')
  process.exit(1)
}

const [,, pubId] = process.argv
if (!pubId) {
  console.error('usage: force-r2-storage.ts <publicationId>')
  process.exit(1)
}

await prisma.publication.update({
  where: { id: pubId },
  data: {
    storage: 'r2',
    r2Key: `shares/${pubId}/artifact.html`,
    // Clear the DB copy — an r2 row normally has no HTML in the column.
    artifactHtml: null,
  },
})

await prisma.$disconnect()
console.log(`[test] updated ${pubId} → storage=r2 (simulates config drift)`)
