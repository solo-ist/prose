/**
 * Smoke test — verifies the app launches, the editor mounts,
 * and basic text input works.
 */

import { test, expect } from '@playwright/test'
import {
  launchApp,
  dismissConsentDialog,
  waitForEditor,
  typeInEditor,
  getEditorMarkdown,
  setEditorContent,
  runEditorCommand,
} from './helpers'
import type { ElectronApplication, Page } from '@playwright/test'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  test.setTimeout(60_000)

  const launched = await launchApp()
  app = launched.app
  page = launched.page

  // Dismiss onboarding dialogs shown on fresh installs
  await dismissConsentDialog(page)

  // DefaultHandlerPrompt ("Make Prose Your Default Markdown Editor") — appears after 1s delay
  const gotItButton = page.getByRole('button', { name: 'Got It' })
  if (await gotItButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await gotItButton.click()
  }

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

test('app window opens with correct title', async () => {
  const title = await page.title()
  // Electron app title — may be "prose" or "Prose" depending on build
  expect(title.toLowerCase()).toContain('prose')
})

test('editor mounts and accepts input', async () => {
  await waitForEditor(page)

  // Type some text
  await typeInEditor(page, 'Hello from Playwright')

  // Verify via markdown export
  const markdown = await getEditorMarkdown(page)
  expect(markdown).toContain('Hello from Playwright')
})

test('bold formatting works via command', async () => {
  // Clear and set fresh content
  await setEditorContent(page, '<p>format me</p>')

  // Select all and toggle bold
  await page.click('.ProseMirror')
  await page.keyboard.press('ControlOrMeta+A')
  await runEditorCommand(page, 'toggleBold')

  // Check that bold mark is active
  const isBold = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    return editor?.isActive('bold') ?? false
  })
  expect(isBold).toBe(true)
})

test('keyboard shortcut Cmd+B toggles bold', async () => {
  await setEditorContent(page, '<p>shortcut test</p>')

  await page.click('.ProseMirror')
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('ControlOrMeta+B')

  const isBold = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    return editor?.isActive('bold') ?? false
  })
  expect(isBold).toBe(true)
})
