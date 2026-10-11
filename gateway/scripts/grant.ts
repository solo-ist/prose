/**
 * grant.ts — grant or revoke a gated feature by email (#965). Idempotent.
 *
 * Works whether or not the account exists yet: an existing account gets an
 * `entitlements` row directly; an unknown email gets an `entitlement_invites`
 * row that is claimed the first time that person hits the gate
 * (src/entitlements/index.ts). So grant BEFORE sending the invite.
 *
 *   npm run grant -- --email a@x.com,b@y.com --feature share_publish --by beta
 *        [--expires 2027-01-31] [--notes "beta wave 1"] [--dry-run]
 *   npm run grant -- --email a@x.com --feature share_publish --revoke
 *   npm run grant -- --list [--feature share_publish]
 *
 * --email is repeatable and takes comma lists (Render one-off jobs can't
 * upload a file, so a whole wave goes on one command line).
 * --expires is inclusive: access lasts through that date (UTC).
 * Rows granted by `opencollective` belong to the #953 reconcile job and are
 * never changed or removed here.
 */
import 'dotenv/config'
import { prisma } from '../src/db/index.js'

const FEATURES = ['share_publish', 'ai_proxy']
const GRANTERS = ['beta', 'comp', 'manual']
const RESERVED_GRANTER = 'opencollective'
const EMAIL_RE = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const USAGE = `Usage:
  npm run grant -- --email <a@x[,b@y]> --feature <${FEATURES.join('|')}> --by <${GRANTERS.join('|')}>
                   [--expires YYYY-MM-DD] [--notes <text>] [--dry-run]
  npm run grant -- --email <a@x[,b@y]> --feature <feature> --revoke [--dry-run]
  npm run grant -- --list [--feature <feature>]`

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`)
  process.exit(1)
}

const argv = process.argv.slice(2)
const flags = new Set<string>()
const values = new Map<string, string[]>()
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) fail(`Unexpected argument: ${a}`)
  const name = a.slice(2)
  if (['revoke', 'list', 'dry-run'].includes(name)) {
    flags.add(name)
    continue
  }
  if (!['email', 'feature', 'by', 'expires', 'notes'].includes(name)) fail(`Unknown flag: ${a}`)
  const v = argv[++i]
  if (v === undefined || v.startsWith('--')) fail(`${a} needs a value`)
  values.set(name, [...(values.get(name) ?? []), v])
}
const one = (name: string): string | undefined => {
  const v = values.get(name)
  if (v && v.length > 1) fail(`--${name} given more than once`)
  return v?.[0]
}

const feature = one('feature')
if (feature !== undefined && !FEATURES.includes(feature)) fail(`Unknown feature "${feature}"`)

if (flags.has('list')) {
  await list(feature)
  await prisma.$disconnect()
  process.exit(0)
}

const revoke = flags.has('revoke')
const dryRun = flags.has('dry-run')
const by = one('by')
const notes = one('notes') ?? null
const expiresArg = one('expires')

if (!feature) fail('--feature is required')
const emails = [
  ...new Set(
    (values.get('email') ?? [])
      .flatMap((v) => v.split(','))
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  ),
]
if (emails.length === 0) fail('--email is required')
const bad = emails.filter((e) => !EMAIL_RE.test(e))
if (bad.length) fail(`Not an email address: ${bad.join(', ')}`)

let expiresAt: Date | null = null
if (revoke) {
  if (by || expiresArg || values.has('notes')) fail('--revoke takes only --email and --feature')
} else {
  if (!by) fail('--by is required')
  if (by === RESERVED_GRANTER) fail(`--by ${RESERVED_GRANTER} is reserved for the Open Collective reconcile job (#953)`)
  if (!GRANTERS.includes(by)) fail(`Unknown --by "${by}"`)
  if (expiresArg !== undefined) {
    if (!DATE_RE.test(expiresArg)) fail('--expires must be YYYY-MM-DD')
    expiresAt = new Date(`${expiresArg}T23:59:59.999Z`)
    if (Number.isNaN(expiresAt.getTime())) fail(`Invalid date: ${expiresArg}`)
    if (expiresAt.getTime() < Date.now()) console.warn(`! --expires ${expiresArg} is in the past; the grant is inert.`)
  }
}

const counts = new Map<string, number>()
const report = (status: string, email: string, detail = ''): void => {
  counts.set(status, (counts.get(status) ?? 0) + 1)
  console.log(`${status.padEnd(9)} ${email}${detail ? `  ${detail}` : ''}`)
}
const describe = (): string =>
  `(${feature}, ${by}${expiresAt ? `, through ${expiresArg}` : ''})`

for (const email of emails) {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  })
  const existing = user
    ? await prisma.entitlement.findUnique({ where: { userId_feature: { userId: user.id, feature } } })
    : null
  if (existing?.grantedBy === RESERVED_GRANTER) {
    report('skipped', email, `(${feature} is managed by Open Collective)`)
    continue
  }

  if (revoke) {
    const pending = await prisma.entitlementInvite.count({
      where: { email, feature, claimedAt: null },
    })
    if (!existing && pending === 0) {
      report('unchanged', email, `(no ${feature} grant)`)
      continue
    }
    if (!dryRun) {
      await prisma.$transaction([
        ...(existing ? [prisma.entitlement.delete({ where: { id: existing.id } })] : []),
        prisma.entitlementInvite.deleteMany({ where: { email, feature, claimedAt: null } }),
      ])
    }
    report('revoked', email, `(${feature})`)
    continue
  }

  if (user) {
    if (!dryRun) {
      await prisma.$transaction([
        prisma.entitlement.upsert({
          where: { userId_feature: { userId: user.id, feature } },
          create: { userId: user.id, feature, grantedBy: by!, expiresAt, notes },
          update: { grantedBy: by!, expiresAt, notes },
        }),
        // A direct grant supersedes any pending invite; leaving one behind
        // would silently re-grant after this grant expires or is revoked.
        prisma.entitlementInvite.deleteMany({ where: { email, feature, claimedAt: null } }),
      ])
    }
    report('granted', email, describe())
  } else {
    if (!dryRun) {
      // Resetting the claim re-arms an invite whose earlier claimant's
      // account was deleted.
      await prisma.entitlementInvite.upsert({
        where: { email_feature: { email, feature } },
        create: { email, feature, grantedBy: by!, expiresAt, notes },
        update: { grantedBy: by!, expiresAt, notes, claimedAt: null, claimedByUserId: null },
      })
    }
    report('invited', email, `${describe()} — claimed on first sign-in`)
  }
}

const summary = [...counts].map(([s, n]) => `${n} ${s}`).join(', ')
console.log(`\n${dryRun ? '[dry run — nothing written] ' : ''}${summary}`)
await prisma.$disconnect()

async function list(feature: string | undefined): Promise<void> {
  const grants = await prisma.entitlement.findMany({
    where: feature ? { feature } : {},
    include: { user: { select: { email: true } } },
    orderBy: [{ feature: 'asc' }, { grantedAt: 'asc' }],
  })
  const invites = await prisma.entitlementInvite.findMany({
    where: { claimedAt: null, ...(feature ? { feature } : {}) },
    orderBy: [{ feature: 'asc' }, { createdAt: 'asc' }],
  })
  const day = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '-')
  console.log(`Grants (${grants.length}):`)
  for (const g of grants) {
    const expired = g.expiresAt && g.expiresAt.getTime() < Date.now() ? ' EXPIRED' : ''
    console.log(`  ${g.user.email}  ${g.feature}  by=${g.grantedBy}  since=${day(g.grantedAt)}  until=${day(g.expiresAt)}${expired}`)
  }
  console.log(`Pending invites (${invites.length}):`)
  for (const i of invites) {
    console.log(`  ${i.email}  ${i.feature}  by=${i.grantedBy}  invited=${day(i.createdAt)}  until=${day(i.expiresAt)}`)
  }
}
