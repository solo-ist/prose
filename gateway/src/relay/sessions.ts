/**
 * relay/sessions.ts — keep 30-day refresh tokens alive past the consent's
 * browser session (#1238).
 *
 * The OAuth provider binds tokens to the browser session the writer consented
 * in and treats a token whose session row has EXPIRED as inactive; a refreshed
 * token inherits that binding. Deleting the expired row clears the binding
 * (the token → session foreign keys are ON DELETE SET NULL), and an
 * offline_access refresh token outlives its session by design. So expired
 * sessions are deleted before each token exchange and hourly. An expired
 * session is unusable anyway; Better Auth deletes one itself when its cookie
 * is next presented.
 */
import { prisma } from '../db/index.js'

export async function deleteExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return count
}

export function startSessionSweep(): void {
  const sweep = () =>
    deleteExpiredSessions().catch((err) => {
      console.error('[relay] expired-session sweep failed:', err instanceof Error ? err.message : 'unknown error')
    })
  void sweep()
  setInterval(sweep, 60 * 60 * 1000).unref()
}
