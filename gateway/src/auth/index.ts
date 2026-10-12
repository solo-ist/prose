/**
 * auth/index.ts — Better Auth (self-hostable; the resolved #601 pick).
 * Credential = a 6-digit code emailed to the user (#964), via Better Auth's
 * emailOTP plugin. Do NOT hand-roll session/token crypto.
 *
 * Only one plugin route is live: POST /api/auth/sign-in/email-otp {email, otp}
 * (verifies, creates the user on first sign-in, sets the session cookie).
 * Codes are issued by the gateway's own POST /api/sign-in/code (auth/code.ts)
 * rather than the plugin's send route, because the plugin swallows delivery
 * errors — a Resend failure would read as "check your email" to a user whose
 * email never left.
 */
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { emailOTP } from 'better-auth/plugins'
import { prisma } from '../db/index.js'
import { config, corsOrigins } from '../config.js'

/** Code lifetime. The email copy and the desktop's pending window match it. */
export const SIGN_IN_CODE_TTL_S = 600

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.BETTER_AUTH_URL,
  // Origin/CSRF posture (#601): only these origins may drive cookie-authed flows.
  trustedOrigins: corsOrigins,
  // Better Auth's limiter can't see client IPs behind Render's proxy, so it
  // would put every caller in one bucket. app.ts applies ipRateLimit (which
  // reads Render's appended X-Forwarded-For) to the sign-in routes instead.
  rateLimit: { enabled: false },
  // Every emailOTP route except sign-in stays dark: the send route is
  // replaced by auth/code.ts, check-verification-otp reveals whether an
  // account exists, and there are no passwords or email changes.
  disabledPaths: [
    '/email-otp/send-verification-otp',
    '/email-otp/check-verification-otp',
    '/email-otp/verify-email',
    '/email-otp/request-password-reset',
    '/forget-password/email-otp',
    '/email-otp/reset-password',
    '/email-otp/request-email-change',
    '/email-otp/change-email',
  ],
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: SIGN_IN_CODE_TTL_S,
      // Wrong guesses per code. At the limit the code is consumed, so even
      // the right code fails and the user must request a new one.
      allowedAttempts: 5,
      // A DB read must not yield a usable code.
      storeOTP: 'hashed',
      // Unreachable: every route that sends is disabled above.
      sendVerificationOTP: async ({ type }) => {
        console.warn(`[auth] unexpected emailOTP send (type=${type}); ignored`)
      },
    }),
  ],
})

export type Auth = typeof auth
