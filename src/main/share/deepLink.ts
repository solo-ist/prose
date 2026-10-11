/**
 * share/deepLink.ts — prose://auth?code=…&state=… (#964): the sign-in email's
 * "Open in Prose" button, relayed through the gateway's /auth/code page.
 *
 * The link is honored only while this desktop is waiting on a sign-in with a
 * matching state (share/index.ts completeSignInFromLink); otherwise it is
 * dropped without any network call. Kept separate from parseProseUrl's
 * prose://open handling: an auth link never reaches the renderer's content
 * queue, and a cold launch simply ignores it (no sign-in is pending in a
 * fresh process; the gateway page still shows the code to type).
 *
 * Accepted risk: another local app could register prose:// and receive the
 * link. That requires software already running on the machine, and exposes
 * no more than the code sitting in the user's inbox.
 */
import { BrowserWindow } from 'electron'
import { IS_MAS_BUILD } from '../env'

const CODE_RE = /^\d{6}$/
// Mirrors SIGN_IN_STATE_RE in gateway/src/auth/code.ts.
const STATE_RE = /^[A-Za-z0-9_-]{22,64}$/

/** True for any prose://auth URL, valid or not — those never fall through to prose://open. */
export function isAuthDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'prose:' && parsed.hostname.toLowerCase() === 'auth'
  } catch {
    return false
  }
}

export function parseAuthDeepLink(url: string): { code: string; state: string } | null {
  if (!isAuthDeepLink(url)) return null
  const params = new URL(url).searchParams
  const code = params.get('code') ?? ''
  const state = params.get('state') ?? ''
  if (!CODE_RE.test(code) || !STATE_RE.test(state)) return null
  return { code, state }
}

export async function handleAuthDeepLink(url: string): Promise<void> {
  if (IS_MAS_BUILD) return
  const link = parseAuthDeepLink(url)
  if (!link) {
    console.warn('[prose://auth] Rejected malformed link')
    return
  }
  const share = await import('./index')
  const result = await share.completeSignInFromLink(link.code, link.state)
  if (!result) {
    console.warn('[prose://auth] Ignored: no matching sign-in is pending')
    return
  }
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('share:authChanged', result)
}
