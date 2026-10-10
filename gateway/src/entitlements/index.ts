/**
 * entitlements/index.ts — the source of truth for feature gating.
 * Grants live in `entitlements` (per user) and `entitlement_invites` (per
 * email, for accounts that may not exist yet — #965). An invite is claimed
 * into an entitlement the first time its owner hits the gate.
 */
import { prisma } from '../db/index.js'

export type GateUser = { id: string; email: string }

function live(expiresAt: Date | null): boolean {
  return !expiresAt || expiresAt.getTime() >= Date.now()
}

/**
 * True iff `user` holds a non-expired grant for `feature`, claiming a pending
 * invite for their email on a miss. DB errors propagate — callers
 * (requireEntitlement) translate them to 503, so an outage never reads as a
 * denial.
 *
 * Claiming here rather than in a sign-up hook covers accounts that already
 * existed, an invite written while the user was mid sign-up, and a hook
 * failure that would otherwise be silent. It costs nothing on the hot path:
 * the invite lookup only runs on what would otherwise be a 403. The email is
 * trustworthy because sign-in requires a code sent to it.
 */
export async function hasEntitlement(user: GateUser, feature: string): Promise<boolean> {
  const row = await prisma.entitlement.findUnique({
    where: { userId_feature: { userId: user.id, feature } },
  })
  if (row && live(row.expiresAt)) return true
  return claimInvite(user, feature)
}

async function claimInvite(user: GateUser, feature: string): Promise<boolean> {
  const email = user.email.trim().toLowerCase()
  return prisma.$transaction(async (tx) => {
    const invite = await tx.entitlementInvite.findUnique({
      where: { email_feature: { email, feature } },
    })
    if (!invite || invite.claimedAt || !live(invite.expiresAt)) return false
    // Conditional update: of two concurrent claims, only one flips claimedAt.
    // The loser blocks on the row lock until the winner commits, so the
    // winner's entitlement is visible to its re-check.
    const claimed = await tx.entitlementInvite.updateMany({
      where: { id: invite.id, claimedAt: null },
      data: { claimedAt: new Date(), claimedByUserId: user.id },
    })
    if (claimed.count === 0) {
      const row = await tx.entitlement.findUnique({
        where: { userId_feature: { userId: user.id, feature } },
      })
      return !!row && live(row.expiresAt)
    }
    const grant = {
      grantedBy: invite.grantedBy,
      expiresAt: invite.expiresAt,
      notes: invite.notes,
    }
    // Upsert: an expired entitlement row may already exist for this pair.
    await tx.entitlement.upsert({
      where: { userId_feature: { userId: user.id, feature } },
      create: { userId: user.id, feature, ...grant },
      update: { ...grant, grantedAt: new Date() },
    })
    console.log(`[entitlement] claimed invite ${invite.id} (${feature}) for user ${user.id}`)
    return true
  })
}
