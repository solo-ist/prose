/**
 * Explorer "Shared" view e2e (#1036) — every share this desktop knows about,
 * live and revoked, with its row states, context-menu actions, and the ◎
 * indicator on shared rows in the folder tree.
 *
 * Pure local rendering: nothing contacts a gateway. Entries are seeded
 * straight into share-sync.json inside an isolated PROSE_USER_DATA_DIR, so
 * the developer's real profile is never touched. The seeded tombstone is 60
 * days old — it proves the former 30-day prune is gone.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  switchExplorerTab,
  selectors,
} from './helpers'

let app: ElectronApplication | null
let page: Page
let userDataDir: string
let docsDir: string

// Allowlisted production API origin — never contacted by this spec.
const GATEWAY = 'https://api.prose.solo.ist'
const DAY = 24 * 60 * 60 * 1000
const T0 = Date.now()
const iso = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString()

const ROW = '[data-testid="shared-row"]'

function syncFilePath(): string {
  return join(userDataDir, 'share-sync.json')
}

// Escape is NOT a safe way to close a context menu here: the editor's Escape
// cascade (find bar → chat → file list) hides the explorer when nothing else
// is open. Click outside instead — Radix dismisses the menu on the pointerdown
// (forced: its DismissableLayer disables pointer events on the rest of the
// page while open, which Playwright's actionability check would wait out).
async function dismissMenu(): Promise<void> {
  await page.locator(selectors.editorContent).click({ position: { x: 20, y: 20 }, force: true })
  await expect(page.getByRole('menu')).toHaveCount(0)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(120_000)

  userDataDir = mkdtempSync(join(tmpdir(), 'prose-shared-view-'))
  docsDir = join(userDataDir, 'docs')
  mkdirSync(docsDir, { recursive: true })
  for (const name of ['active-doc.md', 'foreign-doc.md', 'revoked-doc.md']) {
    writeFileSync(join(docsDir, name), `# ${name}\n\nBody.\n`)
  }

  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', color: 'mono', icon: 'pilcrow', migrationToastShown: true },
        fileAssociation: { hasBeenPrompted: true },
        aiConsent: { consented: false, consentedAt: iso(0), version: 1 },
        recovery: { mode: 'silent' },
        autosave: { mode: 'off', intervalSeconds: 30 },
        defaultSaveDirectory: docsDir,
        // Sharing is on by default since 1.8.1 (#943) — no flag needed.
        webPlatform: { gatewayUrl: GATEWAY },
      },
      null,
      2,
    ),
  )

  const base = {
    documentId: 'seeded',
    publishRev: 'rev1',
    revCount: 3,
    lastPulledAt: null,
    lastCommentCursor: null,
    revokedAt: null as string | null,
    syncMode: 'auto',
    gatewayOrigin: GATEWAY,
  }
  writeFileSync(
    syncFilePath(),
    JSON.stringify(
      {
        version: 1,
        shares: {
          'pub-active': {
            ...base,
            publicationId: 'pub-active',
            shareUrl: 'https://x.share.prose.solo.ist/s/tok-active',
            localPath: join(docsDir, 'active-doc.md'),
            title: 'Active Doc',
            publishedAt: iso(-3 * DAY),
          },
          'pub-foreign': {
            ...base,
            publicationId: 'pub-foreign',
            shareUrl: 'https://elsewhere.example/s/tok-foreign',
            gatewayOrigin: 'https://elsewhere.example',
            localPath: join(docsDir, 'foreign-doc.md'),
            title: 'Foreign Doc',
            publishedAt: iso(-5 * DAY),
          },
          'pub-missing': {
            ...base,
            publicationId: 'pub-missing',
            shareUrl: 'https://x.share.prose.solo.ist/s/tok-missing',
            localPath: join(docsDir, 'gone.md'),
            title: 'Missing Doc',
            publishedAt: iso(-1 * DAY),
          },
          'pub-revoked': {
            ...base,
            publicationId: 'pub-revoked',
            shareUrl: 'https://x.share.prose.solo.ist/s/tok-revoked',
            localPath: join(docsDir, 'revoked-doc.md'),
            title: 'Revoked Doc',
            publishedAt: iso(-90 * DAY),
            revokedAt: iso(-60 * DAY),
          },
        },
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
  rmSync(userDataDir, { recursive: true, force: true })
})

test('lists live shares first and revoked ones under "Previously shared"; a 60-day tombstone survives load', async () => {
  await switchExplorerTab(page, 'shared')
  const panel = page.locator(selectors.fileListPanel)

  await expect(panel.locator(`[data-testid="shared-active"] ${ROW}`)).toHaveCount(3)
  await expect(panel.locator(`[data-testid="shared-revoked"] ${ROW}`)).toHaveCount(1)
  await expect(panel.getByText('Previously shared')).toBeVisible()

  // Newest live share first.
  const liveTitles = await panel.locator(`[data-testid="shared-active"] ${ROW}`).allInnerTexts()
  expect(liveTitles[0]).toContain('Missing Doc')
  expect(liveTitles[1]).toContain('Active Doc')
  expect(liveTitles[2]).toContain('Foreign Doc')

  const revokedRow = panel.locator(ROW, { hasText: 'Revoked Doc' })
  await expect(revokedRow).toContainText('revoked 60d ago')

  // The capability URL is never rendered.
  await expect(panel.getByText('/s/tok-')).toHaveCount(0)
})

test('a live share whose file is gone is marked "file missing" and cannot open', async () => {
  const panel = page.locator(selectors.fileListPanel)
  const row = panel.locator(ROW, { hasText: 'Missing Doc' })
  await expect(row).toContainText('file missing')
  await expect(row).toHaveAttribute('aria-disabled', 'true')
})

test('a share minted on another gateway shows its host', async () => {
  const panel = page.locator(selectors.fileListPanel)
  const row = panel.locator(ROW, { hasText: 'Foreign Doc' })
  await expect(row).toContainText('on elsewhere.example')
})

test('context menus offer the right actions per row state', async () => {
  const panel = page.locator(selectors.fileListPanel)

  await panel.locator(ROW, { hasText: 'Active Doc' }).click({ button: 'right' })
  for (const name of ['Open', 'Copy link', 'Open in browser', 'Open in Finder', 'Revoke']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
  }
  await dismissMenu()

  await panel.locator(ROW, { hasText: 'Revoked Doc' }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Open in browser' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Copy link' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: /Revoke/ })).toHaveCount(0)
  await dismissMenu()

  // aria-disabled fails Playwright's enabled check; the row still owns its context menu.
  await panel.locator(ROW, { hasText: 'Missing Doc' }).click({ button: 'right', force: true })
  await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Open in Finder (file missing)' })).toHaveAttribute('aria-disabled', 'true')
  // The link is still live: copy + revoke stay reachable.
  await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Revoke', exact: true })).toBeVisible()
  await dismissMenu()

  await panel.locator(ROW, { hasText: 'Foreign Doc' }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Revoke (switch gateway)' })).toHaveAttribute('aria-disabled', 'true')
  await dismissMenu()
})

test('revoke is a two-step arm: the first select only relabels the item', async () => {
  const panel = page.locator(selectors.fileListPanel)
  await panel.locator(ROW, { hasText: 'Active Doc' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Revoke', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Really revoke?' })).toBeVisible()
  await dismissMenu()
  // Nothing was revoked (no gateway was contacted), and the arm reset.
  await expect(panel.locator(`[data-testid="shared-active"] ${ROW}`)).toHaveCount(3)
  await panel.locator(ROW, { hasText: 'Active Doc' }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Revoke', exact: true })).toBeVisible()
  await dismissMenu()
})

test('clicking a row opens the document', async () => {
  const panel = page.locator(selectors.fileListPanel)
  await panel.locator(ROW, { hasText: 'Active Doc' }).click()
  await expect(page.locator(selectors.editorContent)).toContainText('active-doc.md', { timeout: 10_000 })
})

test('the Files tree marks documents with a live share', async () => {
  await switchExplorerTab(page, 'files')
  const panel = page.locator(selectors.fileListPanel)
  await expect(panel.getByText('active-doc', { exact: true })).toBeVisible({ timeout: 10_000 })
  // active-doc + foreign-doc are live; revoked-doc is not; gone.md isn't on disk.
  await expect(panel.locator('[data-testid="shared-indicator"]')).toHaveCount(2)
})

test('tombstones are still on disk after the session', async () => {
  await app?.close()
  app = null
  const meta = JSON.parse(readFileSync(syncFilePath(), 'utf-8'))
  expect(Object.keys(meta.shares).sort()).toEqual(['pub-active', 'pub-foreign', 'pub-missing', 'pub-revoked'])
  expect(meta.shares['pub-revoked'].revokedAt).not.toBeNull()
})
