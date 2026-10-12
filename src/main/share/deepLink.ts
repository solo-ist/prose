/**
 * share/deepLink.ts — prose-signin://auth?code=…&state=… (#964, #970): the
 * sign-in email's "Open in Prose" button, relayed through the gateway's
 * /auth/code page.
 *
 * The link is honored only while this desktop is waiting on a sign-in with a
 * matching state (share/index.ts completeSignInFromLink); otherwise it is
 * dropped without any network call. Kept separate from parseProseUrl's
 * prose://open handling: an auth link never reaches the renderer's content
 * queue, and a cold launch simply ignores it (no sign-in is pending in a
 * fresh process; the gateway page still shows the code to type).
 *
 * Its own scheme (#970) because every build shares the bundle ID
 * ist.solo.prose: only the GitHub build declares prose-signin (the App Store
 * build strips it in build/afterPack.cjs), so macOS can't route the link to
 * an installed App Store copy that has no sign-in. prose://auth was the #964
 * form; it is still caught here so it never falls through to prose://open,
 * but it is rejected.
 *
 * Accepted risk: another local app could register prose-signin:// and
 * receive the link. That requires software already running on the machine,
 * and exposes no more than the code sitting in the user's inbox.
 */
import { BrowserWindow } from 'electron'
import { IS_MAS_BUILD } from '../env'

export const SIGN_IN_SCHEME = 'prose-signin'

const CODE_RE = /^\d{6}$/
// Mirrors SIGN_IN_STATE_RE in gateway/src/auth/code.ts.
const STATE_RE = /^[A-Za-z0-9_-]{22,64}$/

function authLinkScheme(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.toLowerCase() !== 'auth') return null
    if (parsed.protocol === `${SIGN_IN_SCHEME}:` || parsed.protocol === 'prose:') return parsed.protocol
    return null
  } catch {
    return null
  }
}

/** True for any prose-signin://auth or prose://auth URL, valid or not — those never fall through to prose://open. */
export function isAuthDeepLink(url: string): boolean {
  return authLinkScheme(url) !== null
}

export function parseAuthDeepLink(url: string): { code: string; state: string } | null {
  if (authLinkScheme(url) !== `${SIGN_IN_SCHEME}:`) return null
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
    console.warn('[sign-in link] Rejected malformed or prose://auth link')
    return
  }
  const share = await import('./index')
  const result = await share.completeSignInFromLink(link.code, link.state)
  if (!result) {
    console.warn('[sign-in link] Ignored: no matching sign-in is pending')
    return
  }
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('share:authChanged', result)
}
