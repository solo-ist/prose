/**
 * auth/index.ts — Better Auth (self-hostable; the resolved #601 pick).
 * MVP credential = email magic-link. Do NOT hand-roll session/token crypto.
 * Real email delivery via Resend (#813). In development (no RESEND_API_KEY)
 * the raw verify URL is still printed to stdout for test harness compatibility.
 */
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { magicLink } from 'better-auth/plugins'
import { prisma } from '../db/index.js'
import { config, corsOrigins } from '../config.js'
import { sendMail } from '../mail/index.js'
import { escapeHtml } from '../util/html.js'

/**
 * The gateway landing path for magic-link emails (#813). Lives under the API
 * host, outside the /api/auth/* namespace owned by Better Auth, so the token
 * is NEVER consumed on page load. Users copy this URL and paste it into Prose.
 */
export const MAGIC_LINK_LANDING_PATH = '/auth/link'

/**
 * Build the email landing URL from the raw Better Auth verify URL.
 * Extracts the token and callbackURL query params and places them on the
 * landing page path so the token remains unconsumed until the desktop fetches
 * the real verify URL it rebuilds from the landing URL.
 */
export function buildLandingUrl(verifyUrl: string): string {
  const u = new URL(verifyUrl)
  const landing = new URL(MAGIC_LINK_LANDING_PATH, u.origin)
  const token = u.searchParams.get('token')
  const callbackURL = u.searchParams.get('callbackURL')
  if (token) landing.searchParams.set('token', token)
  if (callbackURL) landing.searchParams.set('callbackURL', callbackURL)
  return landing.toString()
}

/**
 * Build the raw Better Auth verify URL from a landing URL. The desktop calls
 * this when the user pastes a landing URL instead of the raw verify URL, so
 * sign-in remains a single paste-and-click regardless of which link the user
 * copied from their email.
 */
export function buildVerifyUrl(landingUrl: string): string {
  const u = new URL(landingUrl)
  const verify = new URL('/api/auth/magic-link/verify', u.origin)
  const token = u.searchParams.get('token')
  const callbackURL = u.searchParams.get('callbackURL')
  if (token) verify.searchParams.set('token', token)
  if (callbackURL) verify.searchParams.set('callbackURL', callbackURL)
  return verify.toString()
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.BETTER_AUTH_URL,
  // Origin/CSRF posture (#601): only these origins may drive cookie-authed flows.
  trustedOrigins: corsOrigins,
  plugins: [
    magicLink({
      // Store only a hash of the token — a DB read must not yield a usable link.
      storeToken: 'hashed',
      sendMagicLink: async ({ email, url }) => {
        // Without a Resend key (dev default) log the raw verify URL to stdout
        // so the test harness regex still works byte-for-byte. With a key we
        // deliver by email regardless of NODE_ENV — even in development — and
        // suppress the stdout line so tests can assert it is absent.
        if (!config.RESEND_API_KEY) {
          console.log(`\n[auth] Magic link for ${email}:\n  ${url}\n`)
          if (config.NODE_ENV === 'development') {
            // Also log the landing URL for manual testing — the regex above only
            // matches the first URL (the raw verify URL), so this is safe.
            console.log(`[auth] Landing page: ${buildLandingUrl(url)}\n`)
          }
          return
        }

        // Production: deliver by email. The emailed link points at the landing
        // page so that clicking it in the mail app does NOT consume the token.
        const landingUrl = buildLandingUrl(url)
        const subject = 'Your Prose sign-in link'
        const text = [
          `Here is your sign-in link for Prose:`,
          ``,
          `  ${landingUrl}`,
          ``,
          `This link expires in about 5 minutes and works once.`,
          ``,
          `To sign in: copy the link above and paste it into the Prose app's Sign-in box.`,
          ``,
          `If you didn't request this, you can safely ignore this email.`,
        ].join('\n')
        const landingUrlEscaped = escapeHtml(landingUrl)
        const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Your Prose sign-in link</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;color:#111">
  <h2 style="margin-bottom:0.5rem">Sign in to Prose</h2>
  <p>Copy the link below and paste it into the Prose app's <strong>Sign-in box</strong>:</p>
  <p style="background:#f4f4f5;border-radius:6px;padding:0.75rem 1rem;word-break:break-all;font-family:monospace;font-size:0.875rem">
    <a href="${landingUrlEscaped}" style="color:#2563eb">${landingUrlEscaped}</a>
  </p>
  <p style="color:#6b7280;font-size:0.875rem">
    This link expires in about 5 minutes and works once.
    <br>If you didn't request this, you can safely ignore this email.
  </p>
</body>
</html>`

        try {
          await sendMail({ to: email, subject, text, html })
        } catch (err) {
          // Log server-side so operators can diagnose delivery failures, then
          // re-throw so sign-in surfaces an error rather than silently dropping
          // the link — a user waiting for an email that was never sent should
          // get an actionable error, not a spin.
          console.error(`[auth] failed to send magic link to ${email}:`, err)
          throw err
        }
      },
    }),
  ],
})

export type Auth = typeof auth
