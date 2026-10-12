/**
 * routes/access.ts — the sharing beta's waitlist (#1018). Session only, NOT
 * entitlement-gated: these are how a signed-in user without the grant finds
 * out where they stand and asks in.
 *
 * Deliberately post-sign-in. An unauthenticated "is this address invited?"
 * lookup would let anyone probe who is in the beta (the same reason the
 * emailOTP plugin's account-existence check is disabled). Here a user only
 * ever learns about the address they just proved they own.
 *
 *   GET  /api/access/share          → { canPublish, requested }
 *   POST /api/access/share/request  → { canPublish, requested }
 */
import { Hono } from 'hono'
import { prisma } from '../db/index.js'
import { config } from '../config.js'
import { hasEntitlement } from '../entitlements/index.js'
import { sendMail } from '../mail/index.js'
import { accessRequestedEmail, accessRequestOperatorEmail } from '../mail/templates/access.js'
import type { AppEnv } from '../middleware/session.js'

const FEATURE = 'share_publish'

export const accessRoutes = new Hono<AppEnv>()

/** The user's standing. hasEntitlement claims a pending invite on a miss. */
async function standing(user: { id: string; email: string }): Promise<{ canPublish: boolean; requested: boolean }> {
  if (await hasEntitlement(user, FEATURE)) return { canPublish: true, requested: false }
  const request = await prisma.accessRequest.findUnique({
    where: { email_feature: { email: user.email.trim().toLowerCase(), feature: FEATURE } },
  })
  return { canPublish: false, requested: request !== null }
}

accessRoutes.get('/share', async (c) => {
  try {
    return c.json(await standing(c.get('user')))
  } catch (err) {
    // A DB error must read as an outage, not as "not in the beta".
    console.error('[access] lookup failed:', err)
    return c.json({ error: 'service_unavailable' }, 503)
  }
})

accessRoutes.post('/share/request', async (c) => {
  const user = c.get('user')
  const email = user.email.trim().toLowerCase()
  let created = false
  try {
    const now = await standing(user)
    if (now.canPublish || now.requested) return c.json(now)
    // The unique (email, feature) index makes this the one-per-address gate:
    // of two racing requests, only one inserts and only that one mails.
    await prisma.accessRequest.create({ data: { email, feature: FEATURE, userId: user.id } })
    created = true
  } catch (err) {
    // P2002 = unique violation: a racing request inserted first.
    if ((err as { code?: unknown } | null)?.code !== 'P2002') {
      console.error('[access] request failed:', err)
      return c.json({ error: 'service_unavailable' }, 503)
    }
  }

  if (created) {
    // The request is recorded either way; a mail failure only costs the
    // notices (`npm run grant -- --list` still shows it), so it doesn't fail
    // the request the user can't retry.
    try {
      await sendMail({ to: email, ...accessRequestedEmail() })
    } catch (err) {
      console.error(`[access] confirmation to ${email} failed:`, err)
    }
    if (config.OPERATOR_EMAIL) {
      try {
        await sendMail({ to: config.OPERATOR_EMAIL, replyTo: email, ...accessRequestOperatorEmail(email) })
      } catch (err) {
        console.error(`[access] operator notice for ${email} failed:`, err)
      }
    } else {
      console.warn(`[access] ${email} requested sharing access; OPERATOR_EMAIL is unset, so no one was emailed`)
    }
  }
  return c.json({ canPublish: false, requested: true })
})
