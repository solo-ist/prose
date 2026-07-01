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
      sendMagicLink: async ({ email, url }) => {
        // Phase 0: no email provider yet — the operator reads the link from logs.
        console.log(`\n[auth] Magic link for ${email}:\n  ${url}\n`)
      },
    }),
  ],
})

export type Auth = typeof auth
