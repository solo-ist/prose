/**
 * The MCP socket lives in the profile in force (#1139).
 *
 * The socket path was computed when the socket-server module loaded, before
 * index.ts redirected userData to the dev profile or the test seam, so a dev
 * instance listened on the installed app's socket and took its MCP traffic.
 * The path is now resolved when the server starts.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay } from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string

test.beforeAll(async () => {
  test.setTimeout(60_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1139-'))
  // No aiConsent: consent stays due, which keeps the release-notes modal off; dismissOnboarding closes the consent dialog.
  writeFileSync(join(qaUserDataDir, 'settings.json'), JSON.stringify({ fileAssociation: { hasBeenPrompted: true } }, null, 2))
  const result = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir, PROSE_DEBUG_PORT: '9229' } })
  app = result.app
  page = result.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
})

test('the MCP socket is created under the profile the app was given', async () => {
  await expect.poll(() => existsSync(join(qaUserDataDir, 'prose.sock')), { timeout: 15_000 }).toBe(true)
  // The main process agrees about where it listens.
  const reported = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  expect(reported).toBe(qaUserDataDir)
})
