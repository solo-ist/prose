/**
 * seed-ai-proxy.ts — grant a gated feature to a user by email. Idempotent.
 * The user must exist first (sign in via magic-link once, then run this).
 *
 *   npm run seed:ai-proxy -- --email you@example.com [--feature ai_proxy]
 */
import 'dotenv/config'
import { prisma } from '../src/db/index.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const email = arg('email')
const feature = arg('feature') ?? 'ai_proxy'

if (!email) {
  console.error('Usage: npm run seed:ai-proxy -- --email <email> [--feature ai_proxy]')
  process.exit(1)
}

const user = await prisma.user.findUnique({ where: { email } })
if (!user) {
  console.error(`No user with email ${email}. Sign in via magic-link first, then re-run.`)
  process.exit(1)
}

await prisma.entitlement.upsert({
  where: { userId_feature: { userId: user.id, feature } },
  create: { userId: user.id, feature, grantedBy: 'manual', notes: 'seed-ai-proxy script' },
  update: {},
})

console.log(`✓ Granted "${feature}" to ${email} (user ${user.id}).`)
await prisma.$disconnect()
