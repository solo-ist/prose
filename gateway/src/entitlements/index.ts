/**
 * entitlements/index.ts — the source of truth for feature gating.
 * Phase 0 ships one feature: `ai_proxy`. The full table (Stripe `granted_by`
 * seam, manual grants) is generalized in Phase 4 (#770).
 */
import { prisma } from '../db/index.js'

/** True iff `userId` holds a non-expired grant for `feature`. Never throws upward. */
export async function hasEntitlement(userId: string, feature: string): Promise<boolean> {
  const row = await prisma.entitlement.findUnique({
    where: { userId_feature: { userId, feature } },
  })
  if (!row) return false
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return false
  return true
}
