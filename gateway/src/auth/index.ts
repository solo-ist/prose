/**
 * auth/index.ts — Better Auth (self-hostable; the resolved #601 pick).
 * MVP credential = email magic-link. Do NOT hand-roll session/token crypto.
 * Phase 0 magic-link "delivery" = log the URL to stdout; real email is deferred.
 */
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { magicLink } from 'better-auth/plugins'
import { prisma } from '../db/index.js'
import { config, corsOrigins } from '../config.js'

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
        // Phase 0: no email provider yet — the operator reads the link from logs.
        // TODO(#813): a magic link in stdout IS the credential — anyone with
        // service-log access can take over the account. Dev-only: in production
        // the link goes nowhere until real email delivery lands, which MUST
        // happen before signups open (with or before Phase 1 #766).
        if (config.NODE_ENV !== 'production') {
          console.log(`\n[auth] Magic link for ${email}:\n  ${url}\n`)
        }
      },
    }),
  ],
})

export type Auth = typeof auth
