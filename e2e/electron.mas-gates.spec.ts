/**
 * The Mac App Store build's gates (#1222).
 *
 * MAS is a build-time stamp (`build:env` writes `src/main/env.ts`; the preload gets
 * `process.env.MAS_BUILD` through an esbuild define), so no runtime switch can put the
 * direct build in MAS mode. This file therefore runs only against a MAS-flagged build
 * and skips otherwise; CI builds the direct app, so it never runs there. Run it before
 * every App Store upload:
 *
 *   MAS_BUILD=1 npm run build
 *   PROSE_DEBUG_PORT=9229 npx playwright test e2e/electron.mas-gates.spec.ts
 *   npm run build   # restore the direct build: env.ts stays `true` until a plain build
 *
 * This is the MAS code on the regular Electron binary, without the sandbox. It pins
 * what the App Store user can see; what the sandbox allows (images, dialog folders,
 * bookmarks) is checked on the TestFlight install (`docs/qa/v1.9.0-mas.md`). Seeds
 * carry no bookmarks: `startAccessingSecurityScopedResource` exists only in the MAS
 * Electron binary, so a seeded bookmark would be cleared at load.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp, waitForAppReady, seedSettings, ensureFileListOpen, selectors } from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const envFile = join(projectRoot, 'src', 'main', 'env.ts')
const MAS_FLAGGED = existsSync(envFile) && /IS_MAS_BUILD = true/.test(readFileSync(envFile, 'utf8'))

const TOOLBAR_MORE = '[data-testid="main-toolbar"] [aria-label="More options"]'
const FILES_MORE = '[data-testid="file-list-panel"] [aria-label="More options"]'
/** What the App Store build gates off; none of it may reach its UI. */
const DIRECT_ONLY = /\b(shar(e|ed|ing)|sign(ed)?[- ]in|claude desktop|mcp|remarkable|auto-?update|direct[- ]download)\b/i

let app: ElectronApplication | undefined
let page: Page
let userDataDir: string
let docsDir: string

async function launch(): Promise<void> {
  const result = await launchApp({
    env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DOCS_DIR: docsDir, PROSE_DEBUG_PORT: process.env.PROSE_DEBUG_PORT ?? '9229' },
  })
  app = result.app
  page = result.page
  await waitForAppReady(page)
  // The flag the renderer reads, so a stale env.ts cannot fake a pass.
  expect(await page.evaluate(() => (window as any).api?.isMasBuild)).toBe(true)
}

test.describe('Electron — Mac App Store gates (#1222)', () => {
  test.skip(!MAS_FLAGGED, 'needs a MAS-flagged build: MAS_BUILD=1 npm run build')

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'prose-1222-'))
    docsDir = mkdtempSync(join(tmpdir(), 'prose-1222-docs-'))
    writeFileSync(join(docsDir, 'notes.md'), '# Notes\n\nA line.\n')
  })

  test.afterEach(async () => {
    await app?.close()
    app = undefined
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(docsDir, { recursive: true, force: true })
  })

  test('a fresh install: five steps, no Claude step, no edition caption', async () => {
    test.setTimeout(90_000)
    await launch()
    const modal = page.getByTestId('onboarding')
    const progress = page.getByTestId('onboarding-progress')
    const primary = page.getByTestId('onboarding-primary')
    const secondary = page.getByTestId('onboarding-secondary')

    await expect(progress).toHaveText(/^1 \/ 5 · Welcome$/i)
    await expect(modal).not.toContainText(DIRECT_ONLY)
    // The design canvas's edition label is not shown to App Store users.
    await expect(modal.getByText('App Store build')).toHaveCount(0)
    await primary.click()
    await page.getByRole('radio', { name: 'Use AI' }).click()
    await primary.click()
    await expect(progress).toHaveText(/^3 \/ 5 · API keys$/i)
    await secondary.click() // Skip for now
    await expect(progress).toHaveText(/^4 \/ 5 · Default editor$/i)
    await secondary.click() // Remind me later
    await expect(progress).toHaveText(/^5 \/ 5 · Done$/i)
    await expect(page.getByTestId('onboarding-summary')).not.toContainText(/skill|desktop/i)
    await expect(modal).not.toContainText(DIRECT_ONLY)
    await primary.click()
    await expect(modal).toHaveCount(0)
  })

  test('an upgrade from the last App Store version reads the App Store notes', async () => {
    test.setTimeout(90_000)
    seedSettings(userDataDir, { lastSeenVersion: '1.6.5', defaultSaveDirectory: docsDir })
    await launch()
    // No dismissOverlay before this: it would Escape the dialog under test.
    const dialog = page.getByTestId('release-notes-dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog).toContainText('Since the last App Store version')
    await expect(dialog).not.toContainText(DIRECT_ONLY)
    // No MCP update button on this build.
    await expect(dialog.getByRole('button', { name: /update/i })).toHaveCount(0)
    await page.getByTestId('release-notes-dismiss').click()
    await expect(dialog).toHaveCount(0)
  })

  test('Share, Shared, Account and Integrations are absent; support replaces the bug report', async () => {
    test.setTimeout(90_000)
    seedSettings(userDataDir, { defaultSaveDirectory: docsDir })
    await launch()

    // Toolbar ⋯: no Share, Request Support instead of Report a Bug.
    await page.locator(TOOLBAR_MORE).click()
    await expect(page.getByRole('menuitem', { name: 'Request Support' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^Share/ })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Report a Bug' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /Skill/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /^Share/ })).toHaveCount(0)

    // Explorer: no Shared toggle, inline or in the panel's overflow.
    await ensureFileListOpen(page)
    await expect(page.locator(selectors.sharedButton)).toHaveCount(0)
    await page.locator(FILES_MORE).click()
    await expect(page.getByRole('menuitem', { name: 'Shared' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Settings: four tabs, and a request for a hidden tab lands on General.
    await page.evaluate(() => (window as any).__prose_account.openSettings())
    const tabs = page.getByRole('dialog').getByRole('tablist').getByRole('tab')
    await expect(tabs).toHaveText(['General', 'Appearance', 'Editor', 'LLM'])
    await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('dialog')).not.toContainText(DIRECT_ONLY)
  })

  test('Remote access never dials out (#1239)', async () => {
    test.setTimeout(90_000)
    // Even a profile carried over with Remote access on stays off here.
    writeFileSync(join(userDataDir, 'mcp-remote.json'), JSON.stringify({ version: 1, enabled: true, deviceId: 'd'.repeat(24), connections: [] }))
    seedSettings(userDataDir, { defaultSaveDirectory: docsDir })
    await launch()
    const status = await page.evaluate(() => (window as any).api.mcpRemoteStatus())
    expect(status).toMatchObject({ available: false, enabled: false, state: 'unavailable' })
    const turnedOn = await page.evaluate(() => (window as any).api.mcpRemoteSetEnabled(true))
    expect(turnedOn).toEqual({ ok: false, error: 'Remote access is not available in the Mac App Store version.' })
    const listed = await page.evaluate(() => (window as any).api.mcpRemoteList())
    expect(listed.ok).toBe(false)
  })
})
