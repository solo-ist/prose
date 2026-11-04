/**
 * The find bar follows edits (#1106).
 *
 * Before #1106 the search plugin rebuilt its decorations from the positions
 * the bar had scanned once, so typing above a match left every highlight at
 * its old offset, and the bar's counter never changed. These cases drive the
 * real bar (⌘F, the input, Enter) and read the painted `.search-match`
 * elements back, so they fail on the old build and pass on the new one.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay, waitForEditor } from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

const findInput = () => page.locator('input[placeholder="Find..."]')
const counter = () => page.locator('[data-testid="find-bar-count"]')
const highlights = () => page.locator('.prose-editor .search-match')

async function setDocument(html: string): Promise<void> {
  await page.evaluate((content) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__prose_editor.commands.setContent(content)
  }, html)
}

/** Open the bar with ⌘F from the editor and search `term`. */
async function search(term: string): Promise<void> {
  await page.locator('.prose-editor .ProseMirror').click()
  await page.keyboard.press('Meta+f')
  await expect(findInput()).toBeVisible()
  await findInput().fill(term)
}

test.beforeAll(async () => {
  test.setTimeout(90_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1106-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-1106-docs-'))
  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify({ defaultSaveDirectory: qaDocsDir, aiConsent: { consented: false, version: 1 }, lastSeenVersion: '0.0.0' }, null, 2)
  )
  const result = await launchApp({
    env: { PROSE_USER_DATA_DIR: qaUserDataDir, PROSE_DOCS_DIR: qaDocsDir, PROSE_DEBUG_PORT: '9229' }
  })
  app = result.app
  page = result.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

test.beforeEach(async () => {
  await page.keyboard.press('Escape')
  await setDocument('<p>needle one</p><p>needle two</p><p>needle three</p>')
})

test.describe('Electron — find bar (#1106)', () => {
  test('highlights stay on their text when text is typed above them', async () => {
    await search('needle')
    await expect(highlights()).toHaveCount(3)
    await expect(counter()).toHaveText('1/3')

    // Type at the very start of the document, above every match.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__prose_editor.commands.focus(1)
    })
    await page.keyboard.type('Intro words. ')

    await expect(highlights()).toHaveCount(3)
    await expect(highlights()).toHaveText(['needle', 'needle', 'needle'])
    await expect(counter()).toHaveText('1/3')
  })

  test('a deleted match leaves the count, a typed one joins it', async () => {
    await search('needle')
    await expect(counter()).toHaveText('1/3')

    // Delete the second paragraph through the editor, as a selection delete would.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      const first = editor.state.doc.child(0).nodeSize
      const second = editor.state.doc.child(1).nodeSize
      editor.commands.deleteRange({ from: first, to: first + second })
    })
    await expect(highlights()).toHaveCount(2)
    await expect(counter()).toHaveText('1/2')

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      editor.commands.focus(editor.state.doc.content.size - 1)
    })
    await page.keyboard.type(' and a needle')
    await expect(highlights()).toHaveCount(3)
    await expect(counter()).toHaveText('1/3')
  })

  test('Enter moves to the next match and the current highlight follows', async () => {
    await search('needle')
    await expect(counter()).toHaveText('1/3')
    await findInput().press('Enter')
    await expect(counter()).toHaveText('2/3')
    await expect(page.locator('.prose-editor .search-match-current')).toHaveText('needle')
    // The second paragraph holds the current match.
    const currentParagraph = await page
      .locator('.prose-editor .search-match-current')
      .evaluate((el) => el.closest('p')?.textContent ?? '')
    expect(currentParagraph).toBe('needle two')
    await findInput().press('Shift+Enter')
    await expect(counter()).toHaveText('1/3')
  })

  test('closing the bar clears the highlights', async () => {
    await search('needle')
    await expect(highlights()).toHaveCount(3)
    await findInput().press('Escape')
    await expect(findInput()).toHaveCount(0)
    await expect(highlights()).toHaveCount(0)
  })
})
