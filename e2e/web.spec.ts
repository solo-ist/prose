/**
 * Web e2e tests — verifies browser-mode build loads, renders fixture files,
 * supports editor interaction, file explorer navigation, toolbar actions,
 * chat panel, and settings dialog.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  selectors,
  waitForEditor,
  typeInEditor,
  getEditorMarkdown,
  ensureFileListOpen,
  switchExplorerTab,
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

// ---------------------------------------------------------------------------
// Smoke tests (existing)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// File Explorer — Navigation
// ---------------------------------------------------------------------------

test.describe('File Explorer — Navigation', () => {
  test('navigate into a subfolder', async () => {
    await ensureFileListOpen(page)
    await switchExplorerTab(page, 'files')

    const panel = page.locator(selectors.fileListPanel)

    // Click the Meeting Notes folder to expand it
    await panel.getByText('Meeting Notes').click()
    await page.waitForTimeout(500)

    // Verify children are visible
    await expect(panel.getByText('Weekly Standup')).toBeVisible({ timeout: 5_000 })
    await expect(panel.getByText('Q1 Planning')).toBeVisible({ timeout: 5_000 })
  })

  test('navigate into another folder', async () => {
    await ensureFileListOpen(page)
    const panel = page.locator(selectors.fileListPanel)

    // Click the Blog Drafts folder to expand it
    await panel.getByText('Blog Drafts').click()
    await page.waitForTimeout(500)

    // Verify children are visible
    await expect(panel.getByText('AI Writing Tools')).toBeVisible({ timeout: 5_000 })
  })

  test('open file from subfolder', async () => {
    await ensureFileListOpen(page)
    const panel = page.locator(selectors.fileListPanel)

    // Expand Meeting Notes if not already expanded
    const weeklyStandup = panel.getByText('Weekly Standup')
    if (!(await weeklyStandup.isVisible().catch(() => false))) {
      await panel.getByText('Meeting Notes').click()
      await page.waitForTimeout(500)
    }

    // Open Weekly Standup file
    await weeklyStandup.click()
    await waitForEditor(page)
    await page.waitForTimeout(500)

    const markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('Weekly Standup')
  })

  test('open file and add content', async () => {
    await ensureFileListOpen(page)
    const panel = page.locator(selectors.fileListPanel)

    // Open Formatting Examples
    await panel.getByText('Formatting Examples').click()
    await waitForEditor(page)
    await page.waitForTimeout(500)

    // Type new content at the end
    await page.click(selectors.editor)
    await page.keyboard.press('End')
    await page.keyboard.type('hello, world')
    await page.waitForTimeout(300)

    const markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('hello, world')
  })
})

// ---------------------------------------------------------------------------
// File Explorer — Tabs
// ---------------------------------------------------------------------------

test.describe('File Explorer — Tabs', () => {
  test('switch to recent files tab', async () => {
    await ensureFileListOpen(page)
    await switchExplorerTab(page, 'recent')

    // Verify the header shows "Recent"
    const panel = page.locator(selectors.fileListPanel)
    await expect(panel.locator('h2')).toHaveText('Recent', { timeout: 3_000 })
  })

  test('switch back to files tab', async () => {
    await ensureFileListOpen(page)
    await switchExplorerTab(page, 'files')

    // Verify the header shows folder name (not "Recent")
    const panel = page.locator(selectors.fileListPanel)
    const headerText = await panel.locator('h2').textContent()
    expect(headerText).not.toBe('Recent')

    // Verify file listing is visible
    await expect(panel.getByText('Welcome to Prose')).toBeVisible({ timeout: 5_000 })
  })

  test('google docs tab button exists', async () => {
    await ensureFileListOpen(page)
    const button = page.locator(selectors.googleDocsButton)
    await expect(button).toBeVisible({ timeout: 3_000 })
  })

  test('notebooks tab button exists', async () => {
    await ensureFileListOpen(page)
    const button = page.locator(selectors.notebooksButton)
    await expect(button).toBeVisible({ timeout: 3_000 })
  })
})

// ---------------------------------------------------------------------------
// Editor Features
// ---------------------------------------------------------------------------

test.describe('Editor Features', () => {
  test('frontmatter displays for files with YAML front matter', async () => {
    await ensureFileListOpen(page)
    const panel = page.locator(selectors.fileListPanel)

    // Expand Meeting Notes if needed
    const q1Planning = panel.getByText('Q1 Planning')
    if (!(await q1Planning.isVisible().catch(() => false))) {
      await panel.getByText('Meeting Notes').click()
      await page.waitForTimeout(500)
    }

    // Open Q1 Planning (has frontmatter with title, date, status, tags)
    await q1Planning.click()
    await waitForEditor(page)
    await page.waitForTimeout(500)

    // Verify frontmatter metadata is displayed (the FrontmatterDisplay component
    // renders key-value pairs from the YAML)
    await expect(page.getByText('Q1 2026 Planning')).toBeVisible({ timeout: 5_000 })
  })

  test('toggle source mode', async () => {
    // Ensure a file is open
    await ensureFileListOpen(page)
    const panel = page.locator(selectors.fileListPanel)
    await panel.getByText('Welcome to Prose').click()
    await waitForEditor(page)
    await page.waitForTimeout(500)

    // Click source mode button
    await page.click(selectors.sourceMode)
    await page.waitForTimeout(500)

    // Verify CodeMirror editor appears
    await expect(page.locator(selectors.sourceEditor)).toBeVisible({ timeout: 5_000 })

    // Toggle back to WYSIWYG
    await page.click(selectors.sourceMode)
    await page.waitForTimeout(500)

    // Verify ProseMirror editor is back
    await expect(page.locator(selectors.editor)).toBeVisible({ timeout: 5_000 })
  })

  test('copy markdown button shows success state', async () => {
    // Ensure a file with content is open
    await ensureFileListOpen(page)
    const panel = page.locator(selectors.fileListPanel)
    await panel.getByText('Welcome to Prose').click()
    await waitForEditor(page)
    await page.waitForTimeout(500)

    // Click Copy Markdown button
    const copyButton = page.locator(selectors.copyMarkdown)
    await copyButton.click()

    // The button should briefly show a check icon (success state)
    // The Check icon replaces Copy icon for ~2 seconds
    const checkIcon = copyButton.locator('svg.lucide-check')
    await expect(checkIcon).toBeVisible({ timeout: 2_000 })
  })
})

// ---------------------------------------------------------------------------
// Toolbar Actions
// ---------------------------------------------------------------------------

test.describe('Toolbar Actions', () => {
  test('toggle theme', async () => {
    // Get initial theme state
    const initialIsDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    )

    // Click theme toggle
    await page.click(selectors.toggleTheme)
    await page.waitForTimeout(300)

    // Verify theme changed
    const afterToggleIsDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    )
    expect(afterToggleIsDark).toBe(!initialIsDark)

    // Toggle back to restore original state
    await page.click(selectors.toggleTheme)
    await page.waitForTimeout(300)

    const restoredIsDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    )
    expect(restoredIsDark).toBe(initialIsDark)
  })

  test('toggle AI annotations button', async () => {
    // Ensure a file is open so the button is enabled
    await ensureFileListOpen(page)
    const panel = page.locator(selectors.fileListPanel)
    await panel.getByText('Welcome to Prose').click()
    await waitForEditor(page)
    await page.waitForTimeout(500)

    // Get initial aria-label
    const annotationsButton = page.locator(selectors.hideAnnotations)
    const initialLabel = await annotationsButton.getAttribute('aria-label')

    // Click the button
    await annotationsButton.click()
    await page.waitForTimeout(300)

    // Verify aria-label changed
    const newLabel = await annotationsButton.getAttribute('aria-label')
    expect(newLabel).not.toBe(initialLabel)

    // Toggle back
    await annotationsButton.click()
    await page.waitForTimeout(300)
  })

  test('more options menu renders all items', async () => {
    // Click the More Options button
    await page.click(selectors.moreOptions)
    await page.waitForTimeout(300)

    // Verify all expected menu items are visible
    const expectedItems = [
      'New Document',
      'Open...',
      'Save',
      'Save as...',
      'Settings',
      'Report a Bug',
      'Request a Feature',
      'Discuss Ideas',
      'Close',
    ]

    for (const item of expectedItems) {
      await expect(page.getByRole('menuitem', { name: item })).toBeVisible({ timeout: 2_000 })
    }

    // Close the menu by pressing Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  test('open settings from more options menu', async () => {
    // Open More Options menu
    await page.click(selectors.moreOptions)
    await page.waitForTimeout(300)

    // Click Settings
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    await page.waitForTimeout(500)

    // Verify settings dialog opened (has tab triggers)
    await expect(page.getByRole('tab', { name: 'General' })).toBeVisible({ timeout: 3_000 })

    // Close settings
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  })
})

// ---------------------------------------------------------------------------
// Chat Panel
// ---------------------------------------------------------------------------

test.describe('Chat Panel', () => {
  test('open and close chat panel', async () => {
    // Open chat panel
    await page.click(selectors.toggleChat)
    await page.waitForTimeout(500)

    // Verify chat textarea is visible
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 3_000 })

    // Close chat panel
    await page.click(selectors.toggleChat)
    await page.waitForTimeout(500)

    // Verify textarea is no longer visible
    await expect(textarea).not.toBeVisible({ timeout: 3_000 })
  })

  test('chat input accepts text', async () => {
    // Open chat panel
    await page.click(selectors.toggleChat)
    await page.waitForTimeout(500)

    // Type into the chat textarea
    const textarea = page.locator('textarea').first()
    await textarea.fill('Hello from the test')
    await page.waitForTimeout(200)

    // Verify text was entered
    await expect(textarea).toHaveValue('Hello from the test')

    // Clear and close
    await textarea.fill('')
    await page.click(selectors.toggleChat)
    await page.waitForTimeout(300)
  })
})

// ---------------------------------------------------------------------------
// Settings Dialog
// ---------------------------------------------------------------------------

test.describe('Settings Dialog', () => {
  test('open settings dialog', async () => {
    // Open via More Options menu
    await page.click(selectors.moreOptions)
    await page.waitForTimeout(300)
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    await page.waitForTimeout(500)

    // Verify all tabs are visible
    const tabs = ['General', 'Editor', 'LLM', 'Integrations', 'Account']
    for (const tab of tabs) {
      await expect(page.getByRole('tab', { name: tab })).toBeVisible({ timeout: 3_000 })
    }
  })

  test('settings tabs are clickable', async () => {
    // Settings dialog should already be open from previous test
    // If not, open it
    const generalTab = page.getByRole('tab', { name: 'General' })
    if (!(await generalTab.isVisible().catch(() => false))) {
      await page.click(selectors.moreOptions)
      await page.waitForTimeout(300)
      await page.getByRole('menuitem', { name: 'Settings' }).click()
      await page.waitForTimeout(500)
    }

    // Click through each tab and verify it becomes selected
    const tabs = ['General', 'Editor', 'LLM', 'Integrations', 'Account']
    for (const tab of tabs) {
      await page.getByRole('tab', { name: tab }).click()
      await page.waitForTimeout(300)

      // Verify the tab is now selected (aria-selected="true")
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute(
        'data-state',
        'active',
        { timeout: 2_000 },
      )
    }
  })

  test('close settings dialog', async () => {
    // Settings dialog should already be open from previous test
    const generalTab = page.getByRole('tab', { name: 'General' })
    if (!(await generalTab.isVisible().catch(() => false))) {
      await page.click(selectors.moreOptions)
      await page.waitForTimeout(300)
      await page.getByRole('menuitem', { name: 'Settings' }).click()
      await page.waitForTimeout(500)
    }

    // Close via Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    // Verify dialog is gone
    await expect(page.getByRole('tab', { name: 'General' })).not.toBeVisible({ timeout: 3_000 })
  })
})
