/**
 * A tab switch keeps the last half-second of edits (#1127).
 *
 * The editor writes its content to the store on a 500ms debounce, and that
 * write discards itself once the active document changes. The tab-bar switch
 * cached the store copy on the leaving tab, so an edit made inside the window
 * reached neither — switching back reloaded the tab without it. The switch now
 * flushes the pending write first.
 *
 * The `select_tab` tool never showed this: its executor serializes the live
 * editor itself. The test clicks the tab bar.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  executeProseTool,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

test.beforeAll(async () => {
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1127-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-1127-docs-'))
  writeFileSync(join(qaUserDataDir, 'settings.json'), JSON.stringify({ defaultSaveDirectory: qaDocsDir }, null, 2))
  const result = await launchApp({
    env: { PROSE_USER_DATA_DIR: qaUserDataDir, PROSE_DOCS_DIR: qaDocsDir, PROSE_DEBUG_PORT: '9229' },
  })
  app = result.app
  page = result.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app.close().catch(() => {})
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

async function docText(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate(() => (window as any).__prose_editor.state.doc.textContent as string)
}

async function open(name: string, firstLine: string): Promise<void> {
  writeFileSync(join(qaDocsDir, name), `# ${firstLine}\n\nA paragraph to type into.\n`)
  expect((await executeProseTool(page, 'open_file', { path: join(qaDocsDir, name) })).success).toBe(true)
  await waitForEditor(page)
  await expect.poll(docText).toContain(firstLine)
}

async function clickTab(name: string, firstLine: string): Promise<void> {
  await page.locator('li button', { hasText: name }).first().click()
  await expect.poll(docText).toContain(firstLine)
}

test('typing and clicking another tab straight away keeps the typed text', async () => {
  await open('1127-other.md', 'Other')
  await open('1127-home.md', 'Home')

  await page.locator('.ProseMirror p', { hasText: 'A paragraph to type into.' }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Typed just before the switch.')
  // No wait: the click lands inside the editor's 500ms store debounce.
  await clickTab('1127-other.md', 'Other')
  expect(await docText()).not.toContain('Typed just before')

  await clickTab('1127-home.md', 'Home')
  expect(await docText()).toContain('A paragraph to type into. Typed just before the switch.')
})
