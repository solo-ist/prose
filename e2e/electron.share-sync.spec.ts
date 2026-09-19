/**
 * Desktop share-sync engine e2e (#915) — the sync + security machinery that
 * fourteen review rounds repaired, tested end-to-end through the REAL app:
 * Electron main process (share IPC handlers, client, metadata store) driven
 * from the renderer over the real preload bridge, against a stub gateway the
 * spec controls on loopback (`isAllowedGatewayUrl` admits http://127.0.0.1).
 *
 * Covered contracts, each tied to the finding that motivated it:
 * - magic-link sign-in captures an ORIGIN-BOUND session; a foreign-origin
 *   link is refused (audit M-01)
 * - operations refuse a session minted by a different gateway origin, before
 *   any network I/O (audit M-01)
 * - share entries are bound to their minting gateway; a differently-pointed
 *   gateway refuses to operate on them (audit M-02)
 * - revoke treats gateway 404 as FAILURE, never a local tombstone (audit M-02)
 * - pulls walk the 500-row pages to completion with gte-boundary dedupe (#906)
 * - the sync pull is cursor-less: pre-cursor edits and deletion tombstones
 *   are adopted (#905 / external report Gap 1, both halves)
 * - author-deleted rows never resurrect: the seenRowIds ledger, recorded only
 *   by the post-merge ack (#905 regression fix)
 * - pulled threads adopt server resolvedAt at creation (#909)
 * - share:ackCursor sanitizes row ids (charset guard) and unions the ledger
 * - file:readBase64 enforces its containment root + image allowlist (H-03)
 *
 * Uses an isolated PROSE_USER_DATA_DIR so the seeded session, settings and
 * share-sync.json never touch the developer's real profile.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  executeProseTool,
} from './helpers'

// ---------------------------------------------------------------------------
// Stub gateway — the spec controls its state directly (same process).
// ---------------------------------------------------------------------------

interface StubRow {
  id: string
  parentId: string | null
  markedText: string
  occurrenceIndex: number
  commentText: string
  authorName: string
  fromAuthor: boolean
  resolvedAt: string | null
  editedAt?: string | null
  deleted?: boolean
  publishRev: string
  createdAt: string
}

interface StubRequest {
  method: string
  path: string
  since: string | null
  hasCookie: boolean
}

const SESSION_COOKIE = 'better-auth.session_token=e2e-session-1'
const PAGE_SIZE = 500

function makeRow(id: string, createdAt: string, patch: Partial<StubRow> = {}): StubRow {
  return {
    id,
    parentId: null,
    markedText: 'quick brown fox',
    occurrenceIndex: 0,
    commentText: `Row ${id}`,
    authorName: 'Reviewer Rae',
    fromAuthor: false,
    resolvedAt: null,
    publishRev: 'rev1',
    createdAt,
    ...patch,
  }
}

class StubGateway {
  server: Server
  origin = ''
  comments: StubRow[] = []
  revokeStatus = 204
  requests: StubRequest[] = []

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res))
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    const addr = this.server.address()
    if (!addr || typeof addr === 'string') throw new Error('stub gateway failed to bind')
    this.origin = `http://127.0.0.1:${addr.port}`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', this.origin)
    const authed = (req.headers.cookie ?? '').includes('e2e-session-1')
    this.requests.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      since: url.searchParams.get('since'),
      hasCookie: authed,
    })

    // Magic-link verification: 302 + the session cookie.
    if (url.pathname.startsWith('/api/auth/magic-link/verify')) {
      res.writeHead(302, {
        Location: `${this.origin}/health`,
        'Set-Cookie': `${SESSION_COOKIE}; Path=/; HttpOnly`,
      })
      res.end()
      return
    }
    if (url.pathname === '/api/auth/get-session') {
      if (!authed) return this.json(res, 200, {})
      return this.json(res, 200, { user: { email: 'reviewer@e2e.test' } })
    }
    if (url.pathname === '/api/auth/sign-out') return this.json(res, 200, { ok: true })

    // Everything under /api/share requires the session.
    if (!authed) return this.json(res, 401, { error: 'Unauthorized' })

    if (req.method === 'POST' && url.pathname === '/api/share/publish') {
      return this.json(res, 200, {
        publicationId: 'pub-published',
        shareUrl: `${this.origin}/s/tok-published`,
        publishRev: 'rev1',
        revCount: 1,
      })
    }
    if (req.method === 'DELETE' && /^\/api\/share\/[^/]+$/.test(url.pathname)) {
      if (this.revokeStatus === 204) {
        res.writeHead(204)
        res.end()
      } else {
        this.json(res, this.revokeStatus, { error: 'not_found' })
      }
      return
    }
    if (req.method === 'GET' && /^\/api\/share\/[^/]+\/comments$/.test(url.pathname)) {
      const since = url.searchParams.get('since')
      // gte on createdAt — mirrors the real route's boundary behavior.
      const eligible = since ? this.comments.filter((c) => c.createdAt >= since) : this.comments
      const page = eligible.slice(0, PAGE_SIZE)
      const nextCursor = page.length > 0 ? page[page.length - 1].createdAt : null
      return this.json(res, 200, { comments: page, nextCursor })
    }
    this.json(res, 404, { error: 'not_found' })
  }
}

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

let app: ElectronApplication
let page: Page
let gateway: StubGateway
let foreignRecorder: StubGateway
let userDataDir: string
let docsDir: string
let docPath: string

const T0 = Date.parse('2026-09-14T10:00:00.000Z')
const iso = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString()

// 1x1 transparent PNG for the readBase64 containment tests.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function syncFilePath(): string {
  return join(userDataDir, 'share-sync.json')
}

function readSyncEntry(publicationId: string): Record<string, unknown> | null {
  try {
    const meta = JSON.parse(readFileSync(syncFilePath(), 'utf-8'))
    return meta.shares?.[publicationId] ?? null
  } catch {
    return null
  }
}

function writeSettings(gatewayUrl: string): void {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', color: 'mono', icon: 'pilcrow', migrationToastShown: true },
        fileAssociation: { hasBeenPrompted: true },
        aiConsent: { consented: false, consentedAt: new Date().toISOString(), version: 1 },
        recovery: { mode: 'silent' },
        autosave: { mode: 'off', intervalSeconds: 30 },
        defaultSaveDirectory: docsDir,
        featureFlags: { webPlatform: true },
        webPlatform: { gatewayUrl },
      },
      null,
      2,
    ),
  )
}

// The preload bridge and the renderer test seams, reached untyped from the
// page context (the e2e tsconfig doesn't load the renderer's Window types).
type BridgeWindow = Window & {
  api: Record<string, (...args: unknown[]) => Promise<unknown>>
  __prose_share: {
    sync: () => Promise<{ ok: boolean; added?: number; error?: string }>
    deleteThread: (id: string) => void
  }
  __prose_tools: {
    getCommentStore: () => Array<Record<string, unknown>>
    getCommentDocId: () => string | null
  }
}

async function callApi<T>(method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ m, a }) => (window as unknown as BridgeWindow).api[m](...a),
    { m: method, a: args },
  ) as Promise<T>
}

/** Run the real pull-merge once via the __prose_share seam. */
async function syncNow(): Promise<{ ok: boolean; added?: number; error?: string }> {
  return page.evaluate(() => (window as unknown as BridgeWindow).__prose_share.sync())
}

async function commentStoreThreads(): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => (window as unknown as BridgeWindow).__prose_tools.getCommentStore())
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(180_000)
  gateway = new StubGateway()
  foreignRecorder = new StubGateway()
  await gateway.start()
  await foreignRecorder.start()

  userDataDir = mkdtempSync(join(tmpdir(), 'prose-share-sync-'))
  docsDir = join(userDataDir, 'docs')
  mkdirSync(docsDir, { recursive: true })
  docPath = join(docsDir, 'shared-doc.md')
  writeFileSync(
    docPath,
    '# Shared Doc\n\nThe quick brown fox jumps over the lazy dog.\n\nAnother paragraph with notable text inside.\n',
  )
  writeFileSync(join(docsDir, 'inline.png'), TINY_PNG)
  writeFileSync(join(userDataDir, 'outside.png'), TINY_PNG)
  // Symlink-escape fixtures (H-03): links that sit lexically INSIDE docsDir but
  // resolve OUTSIDE it. `readFile` would follow them and leak the target's
  // bytes — the realpath containment check must refuse both.
  writeFileSync(join(userDataDir, 'secret.txt'), 'SECRET-OUTSIDE-BYTES')
  symlinkSync(join(userDataDir, 'secret.txt'), join(docsDir, 'leak.png')) // -> outside non-image
  symlinkSync(join(userDataDir, 'outside.png'), join(docsDir, 'sneaky.png')) // -> outside image

  writeSettings(gateway.origin)

  // Seed two publications: pub1 (this gateway) for the sync tests, and one
  // minted by a FOREIGN gateway origin for the M-02 refusal tests.
  const baseEntry = {
    localPath: docPath,
    documentId: 'seeded-doc',
    title: 'Shared Doc',
    publishRev: 'rev1',
    revCount: 1,
    publishedAt: iso(-60_000),
    lastPulledAt: null,
    lastCommentCursor: null,
    revokedAt: null,
    syncMode: 'publish',
  }
  writeFileSync(
    syncFilePath(),
    JSON.stringify(
      {
        version: 1,
        shares: {
          pub1: {
            ...baseEntry,
            publicationId: 'pub1',
            shareUrl: `${gateway.origin}/s/tok-pub1`,
            gatewayOrigin: gateway.origin,
          },
          'pub-foreign': {
            ...baseEntry,
            publicationId: 'pub-foreign',
            shareUrl: 'https://elsewhere.example/s/tok-foreign',
            gatewayOrigin: 'https://elsewhere.example',
            localPath: join(docsDir, 'other.md'),
          },
        },
      },
      null,
      2,
    ),
  )

  // Linux CI has no keyring: without --password-store=basic, safeStorage
  // reports unavailable and credentialStore.set (the sign-in's session
  // write) throws. Basic-backend obfuscation is fine for a throwaway
  // profile; macOS/Windows ignore the switch.
  const launched = await launchApp({
    env: { PROSE_USER_DATA_DIR: userDataDir },
    args: process.platform === 'linux' ? ['--password-store=basic'] : [],
  })
  app = launched.app
  page = launched.page
  // The switch only SELECTS the basic_text backend; isEncryptionAvailable()
  // stays false on Linux until the app opts into the in-memory key. Without
  // this, credentialStore.set (the sign-in's session write) throws on any
  // keyring-less machine. Documented no-op on macOS/Windows.
  await app.evaluate(({ safeStorage }) => safeStorage.setUsePlainTextEncryption(true))
  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)
})

test.afterAll(async () => {
  await app?.close()
  await gateway?.stop()
  await foreignRecorder?.stop()
  rmSync(userDataDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Sign-in + session binding (audit M-01)
// ---------------------------------------------------------------------------

test('a magic link from a different origin is refused', async () => {
  const res = await callApi<{ ok: boolean; code?: string }>(
    'shareCompleteSignIn',
    `${foreignRecorder.origin}/api/auth/magic-link/verify?token=x`,
  )
  expect(res.ok).toBe(false)
  expect(res.code).toBe('wrong_origin')
  // Refused before any network I/O touched the foreign host.
  expect(foreignRecorder.requests).toHaveLength(0)
})

test('magic-link sign-in captures an origin-bound session', async () => {
  const res = await callApi<{ ok: boolean; email?: string }>(
    'shareCompleteSignIn',
    `${gateway.origin}/api/auth/magic-link/verify?token=e2e`,
  )
  // toMatchObject so a failure prints the result's error/code fields.
  expect(res).toMatchObject({ ok: true, email: 'reviewer@e2e.test' })

  const status = await callApi<{ ok: boolean; signedIn?: boolean; email?: string }>('shareAuthStatus')
  expect(status.ok).toBe(true)
  expect(status.signedIn).toBe(true)
  expect(status.email).toBe('reviewer@e2e.test')
})

test('the session refuses a differently-pointed gateway without network I/O', async () => {
  writeSettings(foreignRecorder.origin)
  try {
    const status = await callApi<{ ok: boolean; signedIn?: boolean }>('shareAuthStatus')
    expect(status.ok).toBe(true)
    expect(status.signedIn).toBe(false)

    const pub = await callApi<{ ok: boolean; code?: string }>('sharePublish', {
      title: 'x',
      html: '<p>x</p>',
      localPath: '/tmp/x.md',
      documentId: 'x',
    })
    expect(pub.ok).toBe(false)
    expect(pub.code).toBe('origin_mismatch')

    // The bound cookie never traveled to the other host.
    expect(foreignRecorder.requests).toHaveLength(0)
  } finally {
    writeSettings(gateway.origin)
  }
})

// ---------------------------------------------------------------------------
// Publish bookkeeping
// ---------------------------------------------------------------------------

test('publish records an entry with its minting origin, owner-only perms', async () => {
  const res = await callApi<{ ok: boolean; entry?: { publicationId: string; gatewayOrigin?: string } }>(
    'sharePublish',
    { title: 'Shared Doc', html: '<p>hello</p>', localPath: '/tmp/published.md', documentId: 'doc-published' },
  )
  expect(res).toMatchObject({ ok: true })
  expect(res.entry?.publicationId).toBe('pub-published')
  expect(res.entry?.gatewayOrigin).toBe(gateway.origin)

  const stored = readSyncEntry('pub-published')
  expect(stored).not.toBeNull()
  expect(stored?.gatewayOrigin).toBe(gateway.origin)
  // The file embeds capability URLs — owner-only, always (#912).
  expect(statSync(syncFilePath()).mode & 0o777).toBe(0o600)
})

// ---------------------------------------------------------------------------
// Paged pulls (#906)
// ---------------------------------------------------------------------------

test('pull walks the 500-row pages to completion and dedupes the gte boundary', async () => {
  gateway.comments = Array.from({ length: 1001 }, (_, i) =>
    makeRow(`row-${String(i + 1).padStart(4, '0')}`, iso(i * 1000)),
  )
  gateway.requests = []

  const res = await callApi<{ ok: boolean; comments?: Array<{ id: string }> }>('sharePullComments', 'pub1')
  expect(res).toMatchObject({ ok: true })
  expect(res.comments).toHaveLength(1001)
  expect(new Set(res.comments!.map((c) => c.id)).size).toBe(1001)

  const pulls = gateway.requests.filter((r) => r.path === '/api/share/pub1/comments')
  // Page 1 is cursor-less and ends at row 500; the gte boundary re-serves
  // that row, so page 2 ends at row 999; page 3 (3 rows) finishes the walk.
  expect(pulls.map((r) => r.since)).toEqual([null, iso(499 * 1000), iso(998 * 1000)])
  expect(pulls.every((r) => r.hasCookie)).toBe(true)
})

// ---------------------------------------------------------------------------
// The sync engine proper (#905, Gap 1, #909) — real renderer merge
// ---------------------------------------------------------------------------

test('first sync merges pulled threads and acks the seen ledger', async () => {
  gateway.comments = [
    makeRow('row-a', iso(1000), { commentText: 'Original A' }),
    makeRow('row-b', iso(2000), { markedText: 'notable text', commentText: 'Original B' }),
    // #909: resolution state adopted at creation.
    makeRow('row-c', iso(3000), { markedText: 'lazy dog', commentText: 'Resolved C', resolvedAt: iso(4000) }),
  ]

  const opened = await executeProseTool(page, 'open_file', { path: docPath })
  expect(opened.success).toBe(true)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as BridgeWindow).__prose_tools.getCommentDocId()))
    .not.toBeNull()

  const res = await syncNow()
  expect(res).toMatchObject({ ok: true, added: 3 })

  const threads = await commentStoreThreads()
  const byId = new Map(threads.map((t) => [t.id, t]))
  expect(byId.get('row-a')?.comment).toBe('Original A')
  expect(byId.get('row-b')?.comment).toBe('Original B')
  expect(byId.get('row-c')?.resolved).toBe(true)

  // The ack lands only after the merge persisted — poll for it.
  await expect
    .poll(() => (readSyncEntry('pub1')?.seenRowIds as string[] | undefined)?.slice().sort() ?? [])
    .toEqual(['row-a', 'row-b', 'row-c'])
  expect(readSyncEntry('pub1')?.lastPulledAt).not.toBeNull()
})

test('sync is cursor-less: pre-cursor edits and tombstones are adopted (Gap 1)', async () => {
  // Both rows predate the recorded cursor; a since-filtered pull would never
  // see either revision. The edit half and the tombstone half of Gap 1:
  gateway.comments = [
    makeRow('row-a', iso(1000), { commentText: 'Edited A', editedAt: iso(5000) }),
    makeRow('row-b', iso(2000), { markedText: 'notable text', commentText: '', deleted: true }),
    makeRow('row-c', iso(3000), { markedText: 'lazy dog', commentText: 'Resolved C', resolvedAt: iso(4000) }),
  ]
  gateway.requests = []

  const res = await syncNow()
  expect(res).toMatchObject({ ok: true })

  const threads = await commentStoreThreads()
  const byId = new Map(threads.map((t) => [t.id, t]))
  expect(byId.get('row-a')?.comment).toBe('Edited A')
  expect(byId.has('row-b')).toBe(false)
  expect(byId.get('row-c')?.comment).toBe('Resolved C')

  // The proof of cursor-lessness: a cursor IS recorded, yet the pull's first
  // page request carried no `since`.
  expect(readSyncEntry('pub1')?.lastCommentCursor).not.toBeNull()
  const pulls = gateway.requests.filter((r) => r.path === '/api/share/pub1/comments')
  expect(pulls.length).toBeGreaterThan(0)
  expect(pulls[0].since).toBeNull()
})

test('author-deleted threads stay dead across polls (#905 regression)', async () => {
  // The author deletes row-a's thread locally (CommentPopover's remove path).
  await page.evaluate(() => (window as unknown as BridgeWindow).__prose_share.deleteThread('row-a'))
  let threads = await commentStoreThreads()
  expect(threads.some((t) => t.id === 'row-a')).toBe(false)

  // The gateway still serves row-a live. Two more polls: without the
  // seenRowIds ledger this resurrected the thread (with a toast) every time.
  for (let i = 0; i < 2; i++) {
    const res = await syncNow()
    expect(res).toMatchObject({ ok: true, added: 0 })
  }
  threads = await commentStoreThreads()
  expect(threads.some((t) => t.id === 'row-a')).toBe(false)
  expect(threads.some((t) => t.id === 'row-c')).toBe(true)
})

// ---------------------------------------------------------------------------
// ack guards
// ---------------------------------------------------------------------------

test('ackCursor sanitizes row ids and unions the ledger', async () => {
  const bad = await callApi<{ ok: boolean }>('shareAckCursor', 'pub1', 'cursor-x', [
    'clean-id-1',
    '../../api/auth/x',
    'x'.repeat(65),
  ])
  expect(bad.ok).toBe(true)

  const seen = (readSyncEntry('pub1')?.seenRowIds as string[]) ?? []
  expect(seen).toContain('clean-id-1')
  expect(seen).toContain('row-a')
  expect(seen.some((s) => s.includes('..') || s.length > 64 || s === '')).toBe(false)

  // Union, not overwrite: a second ack adds without dropping.
  await callApi('shareAckCursor', 'pub1', 'cursor-y', ['clean-id-2'])
  const after = (readSyncEntry('pub1')?.seenRowIds as string[]) ?? []
  expect(after).toEqual(expect.arrayContaining(['clean-id-1', 'clean-id-2', 'row-a']))
  expect(after.filter((s) => s === 'clean-id-1')).toHaveLength(1)
})

// ---------------------------------------------------------------------------
// Entry ↔ gateway binding (audit M-02)
// ---------------------------------------------------------------------------

test('entries minted by another gateway are refused before any network I/O', async () => {
  gateway.requests = []
  const pull = await callApi<{ ok: boolean; code?: string }>('sharePullComments', 'pub-foreign')
  expect(pull.ok).toBe(false)
  expect(pull.code).toBe('wrong_gateway')

  const revoke = await callApi<{ ok: boolean; code?: string }>('shareRevoke', 'pub-foreign')
  expect(revoke.ok).toBe(false)
  expect(revoke.code).toBe('wrong_gateway')
  expect(readSyncEntry('pub-foreign')?.revokedAt).toBeNull()
  expect(gateway.requests.filter((r) => r.path.includes('pub-foreign'))).toHaveLength(0)
})

test('revoke treats a gateway 404 as failure, success as a local tombstone', async () => {
  gateway.revokeStatus = 404
  const failed = await callApi<{ ok: boolean; code?: string }>('shareRevoke', 'pub-published')
  expect(failed.ok).toBe(false)
  expect(failed.code).toBe('not_found_on_gateway')
  // The false-tombstone bug: a 404 must leave the entry un-revoked.
  expect(readSyncEntry('pub-published')?.revokedAt).toBeNull()

  gateway.revokeStatus = 204
  const ok = await callApi<{ ok: boolean }>('shareRevoke', 'pub-published')
  expect(ok).toMatchObject({ ok: true })
  expect(readSyncEntry('pub-published')?.revokedAt).not.toBeNull()
})

// ---------------------------------------------------------------------------
// file:readBase64 containment (audit H-03)
// ---------------------------------------------------------------------------

test('readBase64 refuses escapes, non-images, and a missing root', async () => {
  const attempt = (path: string, root: string): Promise<string> =>
    page.evaluate(
      async ({ p, r }) => {
        try {
          await (window as unknown as BridgeWindow).api.readFileBase64(p, r)
          return 'allowed'
        } catch (err) {
          return err instanceof Error ? err.message : String(err)
        }
      },
      { p: path, r: root },
    )

  // In-root image reads succeed and round-trip the bytes.
  const good = await callApi<string>('readFileBase64', 'inline.png', docsDir)
  expect(good).toBe(TINY_PNG.toString('base64'))

  expect(await attempt('../outside.png', docsDir)).toContain('outside the document directory')
  expect(await attempt(join(userDataDir, 'outside.png'), docsDir)).toContain('outside the document directory')
  expect(await attempt('shared-doc.md', docsDir)).toContain('limited to image files')
  expect(await attempt('inline.png', '')).toContain('requires a containment root')

  // Symlink escapes (H-03): lexically in-root, but realpath lands outside.
  // Must be refused — never return the outside file's bytes.
  const leak = await attempt('leak.png', docsDir)
  expect(leak).toContain('outside the document directory')
  expect(leak).not.toContain(Buffer.from('SECRET-OUTSIDE-BYTES').toString('base64'))
  expect(await attempt('sneaky.png', docsDir)).toContain('outside the document directory')
})
