/**
 * The dirty flag follows the document (#885).
 *
 * The tab record's `isDirty` is written by a projection 500 ms after the last
 * keystroke. A close inside that window used to read the flag as clean and
 * close the tab without the "Save changes?" prompt, the same half-second hole
 * #1127 closed on the tab switch. The close path now lands the pending
 * projection before it reads the flag, and in source mode the flag follows
 * every transaction.
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
  selectors,
  seedSettings,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

const DOC = '# Heading\n\nSome text to keep.\n'

test.beforeAll(async () => {
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-885-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-885-docs-'))
  seedSettings(qaUserDataDir, { defaultSaveDirectory: qaDocsDir })
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
  await app?.close().catch(() => {})
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

async function openFresh(name: string): Promise<string> {
  const path = join(qaDocsDir, name)
  writeFileSync(path, DOC)
  const opened = await executeProseTool(page, 'open_file', { path })
  expect(opened.success, JSON.stringify(opened)).toBe(true)
  await waitForEditor(page)
  return path
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isDirty = () => page.evaluate(() => (window as any).__prose_tools.getDocumentIsDirty() as boolean)

test('closing a tab right after typing asks before closing', async () => {
  await openFresh('885-close.md')
  await page.locator(selectors.editor).click()
  await page.keyboard.press('End')
  // The pointer waits on the tab's × while the editor keeps the keyboard, so
  // the click lands milliseconds after the last keystroke: inside the
  // projection delay, where the record still says clean. The close must land
  // the projection and ask, not read the stale flag and close.
  await page.locator('li', { hasText: '885-close' }).first().locator(selectors.closeTab).hover()
  await page.keyboard.type(' typed')
  await page.mouse.down()
  await page.mouse.up()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Save changes?')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  expect(await isDirty()).toBe(true)
  await expect(page.locator(selectors.editor)).toContainText('Some text to keep. typed')
})

test('in source mode the dirty flag follows the keystroke, and undo clears it at once', async () => {
  await openFresh('885-source.md')
  await page.locator('[aria-label="Source mode"]').click()
  await page.waitForSelector(selectors.sourceEditor, { timeout: 5_000 })
  await page.locator('.cm-line').first().click()
  await page.keyboard.press('End')
  expect(await isDirty()).toBe(false)
  await page.keyboard.type('x')
  expect(await isDirty(), 'dirty right after the keystroke').toBe(true)
  // CodeMirror's undo is Mod-z: ⌘Z here, Ctrl+Z on the Linux CI runner.
  await page.keyboard.press('ControlOrMeta+z')
  expect(await isDirty(), 'clean right after the undo').toBe(false)
  await page.locator('[aria-label="WYSIWYG mode"]').click()
  await page.waitForSelector(selectors.editor, { state: 'visible', timeout: 5_000 })
  expect(await isDirty()).toBe(false)
})
