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
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay, seedSettings } from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string

test.beforeAll(async () => {
  test.setTimeout(60_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1139-'))
  // The shared seeder: consent given and the release-notes modal off (#1113), so nothing is up over the window.
  seedSettings(qaUserDataDir, { fileAssociation: { hasBeenPrompted: true } })
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
