/**
 * auth/code.ts — POST /api/sign-in/code {email, state?}: email a 6-digit
 * sign-in code (#964). The desktop then signs in with POST
 * /api/auth/sign-in/email-otp {email, otp}, handled by Better Auth
 * (auth/index.ts).
 *
 * `state` is a random nonce the desktop generates per request. When present,
 * the email also carries an "Open in Prose" link to GET /auth/code (app.ts),
 * which hands code + state to the app as prose-signin://auth?code=…&state=…. The
 * desktop accepts that link only while it is waiting on a sign-in with the
 * same state, so a crafted link can't push a code into a desktop that never
 * asked for one. Both values ride in the URL FRAGMENT, which browsers never
 * send to a server: they stay out of request logs and link-scanner fetches.
 *
 * This replaces the emailOTP plugin's own send route so delivery failures
 * surface (502 mail_failed) instead of being swallowed. The code itself is
 * still minted and stored (hashed) by the plugin, via its server-only
 * createVerificationOTP; requesting again replaces the previous code.
 *
 * The response never says whether an account exists — first sign-in creates
 * the account, so every well-formed address gets a code.
 */
import { Hono } from 'hono'
import { auth, SIGN_IN_CODE_TTL_S } from './index.js'
import { config } from '../config.js'
import { sendMail } from '../mail/index.js'
import { signInCodeEmail } from '../mail/templates/signInCode.js'
import { ipRateLimit } from '../middleware/ipRateLimit.js'

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
/** The desktop's nonce: 16+ random bytes, base64url. Anything else is dropped. */
export const SIGN_IN_STATE_RE = /^[A-Za-z0-9_-]{22,64}$/
/** The fallback page the email's "Open in Prose" link points at. */
export const SIGN_IN_LINK_PATH = '/auth/code'

// Codes per address per hour. Bounds both inbox flooding and guessing:
// each code allows a handful of tries before it is burned.
const PER_EMAIL_MAX = 5
const PER_EMAIL_WINDOW_MS = 60 * 60 * 1000
const sentTo = new Map<string, number[]>()

function underEmailLimit(email: string): boolean {
  const now = Date.now()
  const recent = (sentTo.get(email) ?? []).filter((t) => now - t < PER_EMAIL_WINDOW_MS)
  if (recent.length >= PER_EMAIL_MAX) {
    sentTo.set(email, recent)
    return false
  }
  recent.push(now)
  sentTo.set(email, recent)
  if (sentTo.size > 5000) {
    for (const [key, ts] of sentTo) {
      if (ts.every((t) => now - t >= PER_EMAIL_WINDOW_MS)) sentTo.delete(key)
    }
  }
  return true
}

/** The email's "Open in Prose" URL, or null without a usable state. */
export function signInLink(code: string, state: string | undefined): string | null {
  if (!state || !SIGN_IN_STATE_RE.test(state)) return null
  const url = new URL(SIGN_IN_LINK_PATH, config.BETTER_AUTH_URL)
  url.hash = `c=${code}&s=${state}`
  return url.toString()
}

export const signInCodeRoutes = new Hono()

signInCodeRoutes.post('/code', ipRateLimit(config.SIGN_IN_CODE_IP_MAX, 600), async (c) => {
  // JSON only: forces a CORS preflight, so a third-party page can't make a
  // visitor's browser mail codes to arbitrary addresses.
  if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
    return c.json({ error: 'unsupported_media_type' }, 415)
  }
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const raw = (body as { email?: unknown } | null)?.email
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  const rawState = (body as { state?: unknown } | null)?.state
  const state = typeof rawState === 'string' ? rawState : undefined
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return c.json({ error: 'invalid_email' }, 400)
  }
  if (!underEmailLimit(email)) {
    c.header('Retry-After', String(PER_EMAIL_WINDOW_MS / 1000))
    return c.json({ error: 'too_many_codes' }, 429)
  }

  let code: string
  try {
    code = await auth.api.createVerificationOTP({ body: { email, type: 'sign-in' } })
  } catch (err) {
    console.error('[auth] could not create a sign-in code:', err)
    return c.json({ error: 'service_unavailable' }, 503)
  }

  if (!config.RESEND_API_KEY) {
    // Dev only (production config requires Resend): the test harnesses read
    // the code from this line.
    console.log(`[auth] Sign-in code for ${email}: ${code}`)
    const link = signInLink(code, state)
    if (link) console.log(`[auth] Open in Prose: ${link}`)
    return c.json({ ok: true })
  }
  try {
    const minutes = Math.round(SIGN_IN_CODE_TTL_S / 60)
    await sendMail({ to: email, ...signInCodeEmail(code, signInLink(code, state), minutes) })
  } catch (err) {
    console.error(`[auth] failed to send a sign-in code to ${email}:`, err)
    return c.json({ error: 'mail_failed' }, 502)
  }
  return c.json({ ok: true })
})
