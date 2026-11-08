/**
 * LLM keys stay in main (#1240).
 *
 * The renderer learns only which providers have a key (the last four
 * characters, whether it persists): never a key. These cases cover the three
 * places a key used to cross into or out of the renderer: the settings payload,
 * every LLM request, and the Settings key field.
 */
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dismissOnboarding, dismissOverlay, launchApp, openChat, seedSettings, waitForAppReady, waitForEditor } from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SEEDED = 'sk-ant-api03-seeded' + 'a'.repeat(60) + 'SEED'
const TYPED = 'sk-ant-api03-typed' + 'b'.repeat(60) + 'TYPD'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1240-'))
  // A plaintext key in settings.json: written by hand, by an old build, or by
  // a test seed. With secure storage it migrates to the Keychain at load;
  // without (CI's Linux runner), main keeps it for the session.
  seedSettings(userDataDir, {
    llm: { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: SEEDED },
    toolMode: 'create',
  })
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9241' } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  rmSync(userDataDir, { recursive: true, force: true })
})

const loadSettings = () => page.evaluate(() => (window as any).api.loadSettings())
const settingsOnDisk = () => readFileSync(join(userDataDir, 'settings.json'), 'utf-8')

test('a key in settings.json never reaches the renderer; the payload carries its status', async () => {
  const settings = await loadSettings()
  expect(JSON.stringify(settings)).not.toContain(SEEDED)
  expect(settings.llm).not.toHaveProperty('apiKey')
  expect(settings.llm.keyStatus?.anthropic?.hint).toBe('SEED')
})

test("a chat turn's llm:stream request carries no key", async () => {
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as any
    g.__requests = [] as unknown[]
    ipcMain.removeHandler('llm:stream')
    ipcMain.handle('llm:stream', async (event, req: { streamId: string }) => {
      g.__requests.push(req)
      event.sender.send('llm:stream:complete', { streamId: req.streamId, content: 'Done.' })
      return { success: true }
    })
  })
  await waitForEditor(page)
  await openChat(page)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('prose:mode-switch-and-run', { detail: { prompt: 'Say hello.' } }))
  })
  await expect.poll(() => app.evaluate(() => (globalThis as any).__requests.length as number), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
  const request = await app.evaluate(() => (globalThis as any).__requests[0])
  expect(request.provider).toBe('anthropic')
  expect(request).not.toHaveProperty('apiKey')
  expect(JSON.stringify(request)).not.toContain(SEEDED)
})

test('Settings → LLM: the saved key shows by its last four; Clear, then a typed key saved on Save Changes', async () => {
  await page.evaluate(() => (window as any).__prose_account.openSettings())
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'LLM' }).click()

  // One row per provider (#1242); Anthropic's holds the seeded key.
  const row = dialog.getByTestId('llm-key-row-anthropic')
  const status = dialog.getByTestId('llm-key-status-anthropic')
  await expect(status).toContainText('••••••••SEED')
  await expect(dialog.locator('#apiKey-anthropic')).toHaveCount(0)

  await row.getByRole('button', { name: 'Clear' }).click()
  await expect(status).toHaveText('No key')
  await expect.poll(async () => (await loadSettings()).llm.keyStatus?.anthropic ?? null).toBeNull()
  expect(settingsOnDisk()).not.toContain(SEEDED)

  await dialog.locator('#apiKey-anthropic').fill(TYPED)
  await dialog.getByRole('button', { name: 'Save Changes' }).click()
  await expect(dialog).toHaveCount(0)

  const settings = await loadSettings()
  expect(settings.llm.keyStatus?.anthropic?.hint).toBe('TYPD')
  expect(JSON.stringify(settings)).not.toContain(TYPED)
  expect(settingsOnDisk()).not.toContain(TYPED)

  await page.evaluate(() => (window as any).__prose_account.openSettings())
  await page.getByRole('dialog').getByRole('tab', { name: 'LLM' }).click()
  await expect(page.getByRole('dialog').getByTestId('llm-key-status-anthropic')).toContainText('••••••••TYPD')
})
