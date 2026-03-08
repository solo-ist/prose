/**
 * Web smoke tests — verifies the browser-mode build loads,
 * renders fixture files, and supports basic editor interaction.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  selectors,
  waitForEditor,
  typeInEditor,
  getEditorMarkdown,
} from './shared'

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await page.goto('/web-index.html')
  await page.waitForLoadState('domcontentloaded')

  // Dismiss onboarding dialogs that appear on first launch
  // 1. DefaultHandlerPrompt ("Make Prose Your Default Markdown Editor") — appears after 1s delay
  const gotItButton = page.getByRole('button', { name: 'Got It' })
  if (await gotItButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await gotItButton.click()
  }

  // 2. AIConsentDialog ("AI Writing Assistance")
  const useWithoutAI = page.getByRole('button', { name: 'Use Without AI' })
  if (await useWithoutAI.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await useWithoutAI.click()
  }
})

test.afterAll(async () => {
  await page?.close()
})

test('app loads without console errors', async () => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  // Reload to capture errors from a clean load
  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  expect(errors).toEqual([])
})

test('file explorer renders fixture files', async () => {
  // Open file list panel
  await page.click(selectors.showFilesButton)
  await page.waitForSelector(selectors.fileListPanel, { timeout: 5_000 })

  // The mock API includes a "Welcome to Prose" fixture file
  const panel = page.locator(selectors.fileListPanel)
  await expect(panel.getByText('Welcome to Prose')).toBeVisible({ timeout: 5_000 })
})

test('editor accepts keyboard input', async () => {
  await waitForEditor(page)
  await typeInEditor(page, 'Hello web')

  const markdown = await getEditorMarkdown(page)
  expect(markdown).toContain('Hello web')
})

test('navigate: open file from file explorer', async () => {
  // Ensure file list is visible
  const panel = page.locator(selectors.fileListPanel)
  if (!(await panel.isVisible())) {
    await page.click(selectors.showFilesButton)
    await page.waitForSelector(selectors.fileListPanel, { timeout: 5_000 })
  }

  // Click the Welcome file
  await panel.getByText('Welcome to Prose').click()

  // Wait for editor to load the file content
  await waitForEditor(page)
  await page.waitForTimeout(500) // allow content to settle

  const markdown = await getEditorMarkdown(page)
  expect(markdown).toContain('Welcome to Prose')
})
