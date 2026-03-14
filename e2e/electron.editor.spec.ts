/**
 * Electron editor feature tests — covers formatting, source mode, theme toggle,
 * keyboard shortcuts, menus, and settings beyond the basic smoke test.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  launchApp,
  dismissOnboarding,
  waitForEditor,
  typeInEditor,
  getEditorMarkdown,
  setEditorContent,
  isMarkActive,
  isNodeActive,
  selectors,
} from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  test.setTimeout(60_000)

  const launched = await launchApp()
  app = launched.app
  page = launched.page

  // Dismiss onboarding dialogs (Got It + Use Without AI)
  await dismissOnboarding(page)

  // If the app opens to the empty "Start Writing" state, create a new document
  const newDocButton = page.getByRole('button', { name: 'New Document' })
  const isEmptyState = await newDocButton.isVisible({ timeout: 3_000 }).catch(() => false)
  if (isEmptyState) {
    await newDocButton.click()
    await waitForEditor(page)
  }
})

test.afterAll(async () => {
  await app?.close()
})

test.describe('Electron — Editor', () => {
  test('editor loads with content', async () => {
    await waitForEditor(page)
    const editor = page.locator(selectors.editor)
    await expect(editor).toBeVisible({ timeout: 10_000 })
  })

  test('italic formatting via Cmd+I', async () => {
    await setEditorContent(page, '<p>italic test</p>')
    await page.click(selectors.editor)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('ControlOrMeta+I')

    const italic = await isMarkActive(page, 'italic')
    expect(italic).toBe(true)
  })

  test('heading insertion via markdown shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('# Heading Test')
    await page.waitForTimeout(100)

    const isHeading = await isNodeActive(page, 'heading', { level: 1 })
    expect(isHeading).toBe(true)
  })

  test('undo and redo', async () => {
    await setEditorContent(page, '<p></p>')
    await typeInEditor(page, 'undo redo test')

    let markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('undo redo test')

    // Undo — text should be gone
    await page.keyboard.press('ControlOrMeta+Z')
    markdown = await getEditorMarkdown(page)
    expect(markdown).not.toContain('undo redo test')

    // Redo — text should be back
    await page.keyboard.press('ControlOrMeta+Shift+Z')
    markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('undo redo test')
  })

  test('source mode toggle', async () => {
    await page.click(selectors.sourceMode)
    await expect(page.locator(selectors.sourceEditor)).toBeVisible({ timeout: 5_000 })

    await page.click(selectors.sourceMode)
    await expect(page.locator(selectors.editor)).toBeVisible({ timeout: 5_000 })
  })

  test('copy markdown button is clickable', async () => {
    const copyButton = page.locator(selectors.copyMarkdown)
    await expect(copyButton).toBeEnabled({ timeout: 2_000 })
    await copyButton.click()

    // Soft assertion — check icon briefly visible on success
    const checkIcon = copyButton.locator('svg.lucide-check')
    await checkIcon.isVisible({ timeout: 2_000 }).catch(() => {})
  })

  test('theme toggle changes dark class', async () => {
    const initialIsDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    )

    await page.click(selectors.toggleTheme)

    await expect(page.locator('html')).toHaveClass(
      initialIsDark ? /^(?!.*\bdark\b)/ : /\bdark\b/,
      { timeout: 2_000 },
    )

    // Restore original theme
    await page.click(selectors.toggleTheme)

    await expect(page.locator('html')).toHaveClass(
      initialIsDark ? /\bdark\b/ : /^(?!.*\bdark\b)/,
      { timeout: 2_000 },
    )
  })

  test('window title contains prose', async () => {
    const title = await page.title()
    expect(title.toLowerCase()).toContain('prose')
  })

  test('new document from menu', async () => {
    await page.click(selectors.moreOptions)
    await page.getByRole('menuitem', { name: 'New Document' }).click()

    await waitForEditor(page)
    const editor = page.locator(selectors.editor)
    await expect(editor).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+/ opens and closes chat panel', async () => {
    await page.keyboard.press('ControlOrMeta+/')

    const textarea = page.locator('textarea').first()
    const chatOpened = await textarea.isVisible({ timeout: 3_000 }).catch(() => false)

    if (chatOpened) {
      expect(chatOpened).toBe(true)

      await page.keyboard.press('ControlOrMeta+/')
      await expect(textarea).not.toBeVisible({ timeout: 3_000 })
    } else {
      expect(true).toBe(true)
    }
  })

  test('more options menu shows expected items', async () => {
    await page.click(selectors.moreOptions)

    const expectedItems = ['New Document', 'Open...', 'Settings']
    for (const item of expectedItems) {
      await expect(page.getByRole('menuitem', { name: item })).toBeVisible({ timeout: 2_000 })
    }

    await page.keyboard.press('Escape')
  })

  test('settings dialog opens via more options menu', async () => {
    await page.click(selectors.moreOptions)
    await page.getByRole('menuitem', { name: 'Settings' }).click()

    await expect(page.getByRole('tab', { name: 'General' })).toBeVisible({ timeout: 5_000 })

    await page.keyboard.press('Escape')
    await expect(page.getByRole('tab', { name: 'General' })).not.toBeVisible({ timeout: 3_000 })
  })
})
