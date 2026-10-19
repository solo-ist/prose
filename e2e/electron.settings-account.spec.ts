/**
 * Settings → Account (#1059), driven through the real UI against a stub gateway
 * on loopback (`isAllowedGatewayUrl` admits http://127.0.0.1).
 *
 * The point of the issue is not the markup — every IPC channel already existed.
 * It is that the gateway session used to live in `ShareDialog`'s local `useState`,
 * so it existed only while that dialog was open — there was nowhere for a second
 * surface to read it from. These tests cover the flow in Settings, and that the
 * Share dialog agrees with it: one store, two renderers.
 *
 * Stated plainly so the coverage is not oversold: the old dialog refreshed from
 * the gateway on open, so it would also have shown the right state on a fresh
 * open. What the extraction buys is one source of truth and a surface that can
 * exist outside the dialog at all.
 *
 * Runs in an isolated PROSE_USER_DATA_DIR; the seeded session is fictional.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay, executeProseTool } from './helpers'

const STUB_CODE = '424242'
const EMAIL = 'qa-fixture@example.invalid'

/** Only the auth + access routes Settings → Account touches. */
class StubGateway {
  private server: Server
  origin = ''
  signedIn = false
  access = { canPublish: false, requested: false }
  sentCodeTo: string | null = null

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
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}

      // Step 1: request a code. The gateway records the address; main replays
      // THAT address at verify time, never a renderer value (#964).
      if (req.method === 'POST' && url.pathname === '/api/sign-in/code') {
        this.sentCodeTo = String(body.email ?? '')
        return this.json(res, 200, { ok: true })
      }
      // Step 2: exchange the code for a session. The cookie must carry
      // `session_token` — the client filters Set-Cookie on that name and
      // treats anything else as "no session".
      if (req.method === 'POST' && url.pathname === '/api/auth/sign-in/email-otp') {
        if (String(body.otp ?? '') !== STUB_CODE) {
          return this.json(res, 400, { error: 'bad code' })
        }
        this.signedIn = true
        res.setHeader('Set-Cookie', 'session_token=e2e-session-1; Path=/; HttpOnly')
        return this.json(res, 200, { ok: true, user: { email: this.sentCodeTo } })
      }
      if (url.pathname === '/api/auth/get-session') {
        const authed = (req.headers.cookie ?? '').includes('e2e-session-1')
        return this.json(res, 200, authed && this.signedIn ? { user: { email: this.sentCodeTo } } : {})
      }
      if (url.pathname === '/api/auth/sign-out') {
        this.signedIn = false
        return this.json(res, 200, { ok: true })
      }
      if (url.pathname.startsWith('/api/access/share')) {
        if (req.method === 'POST' && url.pathname.endsWith('/request')) {
          this.access = { canPublish: false, requested: true }
        }
        return this.json(res, 200, this.access)
      }
      this.json(res, 404, { error: 'not found' })
    })
  }
}

let app: ElectronApplication
let page: Page
let gateway: StubGateway
let userDataDir: string
let docsDir: string

type SeamWindow = Window & { __prose_account: { openSettings: () => void; closeSettings: () => void } }

const openAccountTab = () =>
  page.evaluate(() => (window as unknown as SeamWindow).__prose_account.openSettings())
const closeSettings = () =>
  page.evaluate(() => (window as unknown as SeamWindow).__prose_account.closeSettings())

test.beforeAll(async () => {
  test.setTimeout(120_000)
  gateway = new StubGateway()
  await gateway.start()

  userDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-account-'))
  docsDir = mkdtempSync(join(tmpdir(), 'prose-qa-account-docs-'))
  writeFileSync(join(docsDir, 'notes.md'), '# Notes\n')

  // Keep to top-level keys plus `appearance`: `settings:load` merges with a
  // shallow spread, so a partial nested object drops its siblings.
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', icon: 'pilcrow' },
        defaultSaveDirectory: docsDir,
        aiConsent: { consented: true, consentedAt: '2026-01-01T00:00:00.000Z', version: 1 },
        fileAssociation: { hasBeenPrompted: true },
        // Sharing is on by default since 1.8.1 (#943), so no featureFlags here.
        webPlatform: { gatewayUrl: gateway.origin },
      },
      null,
      2,
    ),
  )

  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)
})

test.afterAll(async () => {
  await app?.close()
  await gateway?.stop()
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(docsDir, { recursive: true, force: true })
})

test.describe('Electron — Settings → Account (#1059)', () => {
  test('signed out, the Account tab offers the email sign-in form', async () => {
    await openAccountTab()
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible()
  })

  test('email then code signs in, and the tab shows the account', async () => {
    await page.getByPlaceholder('you@example.com').fill(EMAIL)
    await page.getByRole('button', { name: 'Send code' }).click()

    // Main submits the address it recorded at request time, never a renderer
    // value (#964) — so assert the gateway saw the address we typed.
    await expect.poll(() => gateway.sentCodeTo, { timeout: 10_000 }).toBe(EMAIL)

    const codeField = page.getByLabel('Sign-in code')
    await expect(codeField).toBeVisible()
    await codeField.fill(STUB_CODE)

    await expect(page.getByText(EMAIL)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })

  test('a signed-in account without the grant can request access', async () => {
    const requestAccess = page.getByRole('button', { name: 'Request access' })
    await expect(requestAccess).toBeVisible()
    await requestAccess.click()
    await expect.poll(() => gateway.access.requested, { timeout: 10_000 }).toBe(true)
    await expect(page.getByText(/Access requested/)).toBeVisible()
  })

  test('the Share dialog agrees with Settings about the session', async () => {
    // Both surfaces render one store, and this checks they agree. Being precise
    // about what it does NOT prove: the old ShareDialog called its own refresh()
    // on open, so it would have shown signed-in here too. The extraction buys a
    // single source of truth and a second surface that can exist at all — not a
    // fix for a user-visible divergence. Kept because an in-session sign-out from
    // Settings must still be visible here, which the last test covers.
    await closeSettings()
    // "Share..." stays disabled until the active document has a path on disk.
    await executeProseTool(page, 'open_file', { path: join(docsDir, 'notes.md') })
    await page.click('[data-testid="main-toolbar"] [aria-label="More options"]')
    await page.getByRole('menuitem', { name: 'Share...' }).click()

    await expect(page.getByText(new RegExp(`Signed in.*${EMAIL}`))).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Send code' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('signing out from Settings returns both surfaces to signed-out', async () => {
    await openAccountTab()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible({ timeout: 10_000 })

    await closeSettings()
    await page.click('[data-testid="main-toolbar"] [aria-label="More options"]')
    await page.getByRole('menuitem', { name: 'Share...' }).click()
    await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
  })
})
