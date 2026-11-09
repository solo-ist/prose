/**
 * The reMarkable credentials stay in main (#1275, after #1240): the device
 * token and the separate OCR key never reach the renderer, which sees only
 * that each exists.
 */
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dismissOnboarding, dismissOverlay, launchApp, seedSettings, waitForAppReady } from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */

const TOKEN = 'rm-device-token-e2e-' + 'd'.repeat(40) + 'TOKN'
const OCR_KEY = 'sk-ant-api03-ocr-e2e' + 'o'.repeat(50) + 'OCRK'

let app: ElectronApplication
let page: Page
let userDataDir: string
let syncDir: string

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1275-'))
  syncDir = mkdtempSync(join(tmpdir(), 'prose-1275-sync-'))
  // A plaintext device token in settings.json, as an older build or a hand edit leaves it.
  seedSettings(userDataDir, { remarkable: { enabled: true, deviceToken: TOKEN, syncDirectory: syncDir } })
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9244' } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(syncDir, { recursive: true, force: true })
})

const loadSettings = () => page.evaluate(() => (window as any).api.loadSettings())

test('neither the device token nor the OCR key reaches the renderer; it sees only that each exists', async () => {
  // Save an OCR key the way Settings → Integrations → reMarkable does.
  await page.evaluate((key) => (window as any).api.remarkableStoreApiKey(key), OCR_KEY)

  const settings = await loadSettings()
  const payload = JSON.stringify(settings)
  expect(payload).not.toContain(TOKEN)
  expect(payload).not.toContain(OCR_KEY)
  expect(settings.remarkable).not.toHaveProperty('deviceToken')
  expect(settings.remarkable.connected).toBe(true)
  expect(settings.remarkable.hasAnthropicKey).toBe(true)

  // The key's getter is gone; only its status is asked for.
  expect(await page.evaluate(() => typeof (window as any).api.remarkableGetApiKey)).toBe('undefined')
  expect(await page.evaluate(() => (window as any).api.remarkableOcrKeyStatus())).toBe(true)

  // A settings write never puts the token on disk, and the connection survives it.
  await page.evaluate(async () => {
    const api = (window as any).api
    await api.saveSettings(await api.loadSettings())
  })
  const onDisk = readFileSync(join(userDataDir, 'settings.json'), 'utf-8')
  expect(onDisk).not.toContain(TOKEN)
  expect(onDisk).not.toContain(OCR_KEY)
  expect((await loadSettings()).remarkable.connected).toBe(true)

  // Clearing the OCR key leaves the connection; status follows.
  await page.evaluate(() => (window as any).api.remarkableClearApiKey())
  expect(await page.evaluate(() => (window as any).api.remarkableOcrKeyStatus())).toBe(false)
  expect((await loadSettings()).remarkable.hasAnthropicKey).toBe(false)
})
