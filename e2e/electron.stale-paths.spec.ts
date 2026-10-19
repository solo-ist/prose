/**
 * Regression coverage for stale file paths (#727).
 *
 * Uses an isolated PROSE_USER_DATA_DIR profile so seeded recents/session state
 * never touches the developer's real settings or IndexedDB profile.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  waitForEditor,
  dismissOnboarding,
  dismissOverlay,
  executeProseTool,
  getEditorMarkdown,
  selectors,
} from './helpers'
import { ensureFileListOpen } from './shared'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string
let staleDir: string
let stalePath: string
let relocatedPath: string
let existingRecentPath: string
let missingRecentPath: string
let sessionMissingPath: string

function writeSettings(): void {
  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', color: 'mono', icon: 'pilcrow' },
        fileAssociation: { hasBeenPrompted: true },
        aiConsent: { consented: false, consentedAt: new Date().toISOString(), version: 1 },
        recovery: { mode: 'silent' },
        autosave: { mode: 'off', intervalSeconds: 30 },
        defaultSaveDirectory: qaDocsDir,
        recentFiles: [missingRecentPath, existingRecentPath],
      },
      null,
      2,
    ),
  )
}

async function launchIsolatedApp(): Promise<void> {
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)
}

async function stubSaveDialog(filePath: string): Promise<void> {
  await app.evaluate(
    ({ dialog }, targetPath) => {
      const globalState = globalThis as typeof globalThis & {
        __proseOriginalShowSaveDialog?: typeof dialog.showSaveDialog
      }
      if (!globalState.__proseOriginalShowSaveDialog) {
        globalState.__proseOriginalShowSaveDialog = dialog.showSaveDialog
      }
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: targetPath })
    },
    filePath,
  )
}

async function seedSession(session: unknown): Promise<void> {
  await page.evaluate(async (state) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('prose-db')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite')
      tx.objectStore('drafts').put(state, 'session')
      tx.onerror = () => reject(tx.error)
      tx.oncomplete = () => resolve()
    })

    db.close()
  }, session)
}

async function openRecentView(): Promise<void> {
  await ensureFileListOpen(page)

  const recentButton = page.getByRole('button', { name: 'Recent files' })
  if (await recentButton.isVisible({ timeout: 500 }).catch(() => false)) {
    await recentButton.click()
    return
  }

  await page.locator('[data-testid="file-list-panel"] [aria-label="More options"]').click()
  await page.getByRole('menuitem', { name: 'Recent files' }).click()
}

async function setEditorContentWithUpdate(html: string): Promise<void> {
  await page.evaluate((content) => {
    const editor = (window as typeof window & {
      __prose_editor?: { commands: { setContent: (html: string, emitUpdate: boolean) => void } }
    }).__prose_editor
    editor?.commands.setContent(content, true)
  }, html)
}

test.beforeAll(async () => {
  test.setTimeout(180_000)

  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-profile-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-qa-docs-'))
  staleDir = join(qaDocsDir, 'stale-parent')
  stalePath = join(staleDir, 'post.md')
  relocatedPath = join(qaDocsDir, 'relocated-post.md')
  existingRecentPath = join(qaDocsDir, 'existing-recent.md')
  missingRecentPath = join(qaDocsDir, 'missing-recent.md')
  sessionMissingPath = join(qaDocsDir, 'missing-session.md')

  mkdirSync(staleDir, { recursive: true })
  writeFileSync(stalePath, '# Original\n\nBefore move.\n')
  writeFileSync(existingRecentPath, '# Existing recent\n')
  writeSettings()

  await launchIsolatedApp()
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

test.describe('Electron - stale file path recovery', () => {
  test('prunes missing files from the in-app Recents view', async () => {
    await openRecentView()
    const panel = page.locator(selectors.fileListPanel)

    await expect(panel.getByText('existing-recent.md')).toBeVisible({ timeout: 5_000 })
    await expect(panel.getByText('missing-recent.md')).not.toBeVisible({ timeout: 5_000 })

    await expect.poll(async () => {
      const settings = await page.evaluate(async () => (window as any).api.loadSettings())
      return settings.recentFiles ?? []
    }).toEqual([existingRecentPath])
  })

  test('manual save to a removed parent folder relocates through Save As', async () => {
    const opened = await executeProseTool(page, 'open_file', { path: stalePath })
    expect(opened.success).toBe(true)
    await waitForEditor(page)

    rmSync(staleDir, { recursive: true, force: true })
    await stubSaveDialog(relocatedPath)

    await setEditorContentWithUpdate('<h1>Relocated</h1><p>Kept edits.</p>')
    await expect.poll(() => getEditorMarkdown(page), { timeout: 5_000 }).toContain('Kept edits')
    // Wait for the dirty indicator to confirm the edit registered before opening the save menu.
    // Autosave is off in this test profile, so "unsaved" appears in the status bar once isDirty=true.
    await expect(page.getByText('unsaved')).toBeVisible({ timeout: 5_000 })
    await page.locator('[data-testid="main-toolbar"] [aria-label="More options"]').click()
    await page.getByRole('menuitem', { name: 'Save', exact: true }).click()

    await expect.poll(() => existsSync(relocatedPath), { timeout: 5_000 }).toBe(true)
    expect(readFileSync(relocatedPath, 'utf8')).toContain('Kept edits')
    expect(existsSync(staleDir)).toBe(false)
  })

  test('session restore converts a missing saved path into cached unsaved content', async () => {
    const session = {
      tabs: [
        {
          tabId: 'stale-session-tab',
          documentId: 'stale-session-doc',
          path: sessionMissingPath,
          title: 'missing-session',
          content: '# Cached Session\n\nRecovered from IndexedDB.\n',
          isDirty: false,
          frontmatter: {},
          cursorPosition: { line: 1, column: 1 },
          activeChatId: null,
        },
      ],
      activeTabId: 'stale-session-tab',
      savedAt: Date.now(),
    }

    await seedSession(session)
    await app.close()

    await launchIsolatedApp()
    await waitForEditor(page)

    await expect(page.getByText(/missing-session\.md" no longer exists/i)).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => getEditorMarkdown(page), { timeout: 5_000 }).toContain('Recovered from IndexedDB')
  })
})
