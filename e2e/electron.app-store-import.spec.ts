/**
 * Import from the App Store edition (#1243).
 *
 * A fake App Store profile is made the honest way: the app runs once on its
 * own profile, with a project and an open document, and quits. The direct
 * profile under test points at it through `PROSE_APP_STORE_DATA_DIR` (test runs
 * never see a real App Store container) and quits instead of relaunching
 * (`PROSE_IMPORT_RELAUNCH=0`), so each case drives both launches itself.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, waitForAppReady, waitForEditor, seedSettings, executeProseTool } from './helpers'

const PORT = '9243'
let root: string
let storeDir: string
let docsDir: string
let app: ElectronApplication | undefined
let page: Page

const offer = () => page.getByTestId('app-store-import-offer')
const summary = () => page.getByTestId('app-store-import-summary')
const onboarding = () => page.getByTestId('onboarding')

async function launch(userDataDir: string, env: Record<string, string> = {}): Promise<void> {
  const result = await launchApp({
    env: {
      PROSE_USER_DATA_DIR: userDataDir,
      PROSE_DOCS_DIR: docsDir,
      PROSE_DEBUG_PORT: PORT,
      PROSE_APP_STORE_DATA_DIR: storeDir,
      PROSE_IMPORT_RELAUNCH: '0',
      ...env
    }
  })
  app = result.app
  page = result.page
  await waitForAppReady(page)
}

async function close(): Promise<void> {
  await app?.close().catch(() => {})
  app = undefined
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test.beforeAll(async () => {
  test.setTimeout(90_000)
  root = mkdtempSync(join(tmpdir(), 'prose-1243-e2e-'))
  docsDir = join(root, 'docs')
  storeDir = join(root, 'app-store-profile')
  mkdirSync(docsDir, { recursive: true })
  const project = join(docsDir, 'project')
  mkdirSync(project, { recursive: true })
  seedSettings(storeDir, {
    defaultSaveDirectory: docsDir,
    projects: [{ id: 'p-1243', name: 'Imported Project', path: project, bookmark: 'Ym9va21hcms=', createdAt: '2026-01-01T00:00:00.000Z' }]
  })
  writeFileSync(join(docsDir, 'imported-note.md'), '# Imported from the store\n\nThis tab came over.\n')

  // The App Store edition's run: open a document, let the session persist, quit.
  const result = await launchApp({ env: { PROSE_USER_DATA_DIR: storeDir, PROSE_DOCS_DIR: docsDir, PROSE_DEBUG_PORT: PORT } })
  app = result.app
  page = result.page
  await waitForAppReady(page)
  expect((await executeProseTool(page, 'open_file', { path: join(docsDir, 'imported-note.md') })).success).toBe(true)
  await waitForEditor(page)
  await page.waitForTimeout(1_600) // past the 1s session save
  await close()
  // A saved key (not decryptable here, like one encrypted by another signature)
  // and the files that must never cross.
  mkdirSync(join(storeDir, 'credentials'), { recursive: true })
  writeFileSync(join(storeDir, 'credentials', 'llm-api-key'), 'not-a-ciphertext')
  writeFileSync(join(storeDir, 'mcp-auth-token'), 'secret')
  // An App Store user on an older version: this build's notes would be due.
  const storeSettings = readJson(join(storeDir, 'settings.json'))
  writeFileSync(join(storeDir, 'settings.json'), JSON.stringify({ ...storeSettings, lastSeenVersion: '1.6.5' }, null, 2))
})

test.afterEach(async () => {
  await close()
})

test.afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

test.describe('Electron — import from the App Store edition (#1243)', () => {
  test('a fresh profile is offered the import before onboarding; Not now is remembered', async () => {
    const profile = mkdtempSync(join(root, 'fresh-'))
    await launch(profile)
    await expect(offer()).toBeVisible()
    await expect(onboarding()).toHaveCount(0)

    await offer().getByRole('button', { name: 'Not now' }).click()
    await expect(onboarding()).toBeVisible()
    await expect.poll(() => existsSync(join(profile, 'app-store-import.json'))).toBe(true)
    expect(readJson(join(profile, 'app-store-import.json')).state).toBe('declined')

    await close()
    await launch(profile)
    await expect(onboarding()).toBeVisible()
    await expect(offer()).toHaveCount(0)
  })

  test('Import copies the profile at the next launch; the key waits for the user', async () => {
    test.setTimeout(120_000)
    const profile = mkdtempSync(join(root, 'import-'))
    await launch(profile)
    await expect(offer()).toBeVisible()
    const exited = app!.waitForEvent('close')
    await offer().getByRole('button', { name: 'Import and restart' }).click()
    await exited
    app = undefined
    expect(existsSync(join(profile, 'app-store-import.pending.json'))).toBe(true)

    // The launch after the restart does the copy before anything opens the profile.
    await launch(profile)
    await expect(summary()).toBeVisible()
    await expect(summary()).toContainText('Imported from the App Store edition')
    await expect(onboarding()).toHaveCount(0) // the consent came along
    // The summary is the welcome: this build's notes do not stack on it.
    await expect(page.getByTestId('release-notes-dialog')).toHaveCount(0)

    const settings = readJson(join(profile, 'settings.json'))
    const project = settings.projects.find((p: { id: string }) => p.id === 'p-1243')
    expect(project?.name).toBe('Imported Project')
    expect(project?.bookmark).toBeUndefined()
    // IndexedDB came over: the open tab is restored.
    await expect(page.locator('.ProseMirror')).toContainText('Imported from the store')
    // Never copied; the key is staged, not in credentials/.
    // (this launch writes its own MCP token; the App Store edition's never crosses)
    expect(readFileSync(join(profile, 'mcp-auth-token'), 'utf8')).not.toBe('secret')
    expect(existsSync(join(profile, 'credentials', 'llm-api-key'))).toBe(false)
    expect(readdirSync(join(profile, 'app-store-import', 'credentials'))).toEqual(['llm-api-key'])
    // Copy, never move.
    expect(existsSync(join(storeDir, 'credentials', 'llm-api-key'))).toBe(true)

    await expect(summary().getByTestId('app-store-import-key-step')).toBeVisible()
    await summary().getByRole('button', { name: 'Bring my key over' }).click()
    await expect(summary()).toContainText('couldn’t read the key')
    expect(existsSync(join(profile, 'app-store-import'))).toBe(false)
    await summary().getByRole('button', { name: 'Done' }).click()
    await expect(summary()).toHaveCount(0)
    await expect(page.getByTestId('release-notes-dialog')).toHaveCount(0)
    await expect.poll(() => readJson(join(profile, 'app-store-import.json')).acknowledged).toBe(true)

    await close()
    await launch(profile)
    await expect(page.locator('.ProseMirror')).toContainText('Imported from the store')
    await expect(summary()).toHaveCount(0)
    await expect(offer()).toHaveCount(0)
    await page.waitForTimeout(1_000) // the notes load asynchronously
    await expect(page.getByTestId('release-notes-dialog')).toHaveCount(0)
  })

  test('the import refuses while the App Store edition is running', async () => {
    const running = join(root, 'running-store')
    cpSync(storeDir, running, { recursive: true })
    symlinkSync(`${hostname()}-${process.pid}`, join(running, 'SingletonLock'))
    const profile = mkdtempSync(join(root, 'running-'))
    await launch(profile, { PROSE_APP_STORE_DATA_DIR: running })
    await expect(offer()).toBeVisible()
    await offer().getByRole('button', { name: 'Import and restart' }).click()
    await expect(offer().getByRole('alert')).toContainText('Quit the App Store edition')
    expect(existsSync(join(profile, 'app-store-import.pending.json'))).toBe(false)
  })

  test('Settings → General offers the import only when there is one', async () => {
    const profile = mkdtempSync(join(root, 'settings-'))
    seedSettings(profile)
    await launch(profile)
    await expect(offer()).toHaveCount(0) // not fresh: no automatic offer
    await page.evaluate(() => (window as any).__prose_account.openSettings())
    await page.getByRole('dialog').getByRole('tab', { name: 'General' }).click()
    await expect(page.getByTestId('app-store-import-row')).toBeVisible()
    await page.getByTestId('app-store-import-row').getByRole('button', { name: 'Import…' }).click()
    await expect(page.getByTestId('app-store-import-confirm')).toContainText('backup folder')
    await page.getByTestId('app-store-import-confirm').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('app-store-import-confirm')).toHaveCount(0)

    await close()
    await launch(profile, { PROSE_APP_STORE_DATA_DIR: join(root, 'no-such-store') })
    await page.evaluate(() => (window as any).__prose_account.openSettings())
    await page.getByRole('dialog').getByRole('tab', { name: 'General' }).click()
    await expect(page.getByRole('dialog').getByText('Error Reporting')).toBeVisible()
    await expect(page.getByTestId('app-store-import-row')).toHaveCount(0)
  })
})
