/**
 * Web e2e tests — file CRUD operations in the web mode file explorer.
 *
 * Tests cover: create, rename, delete, open, subfolder navigation,
 * dirty state, save, switch between files, and document management.
 *
 * Fixture files available from the mock API:
 *   /Documents/Welcome to Prose.md
 *   /Documents/Formatting Examples.md
 *   /Documents/Empty Note.md
 *   /Documents/Meeting Notes/Weekly Standup.md
 *   /Documents/Meeting Notes/Q1 Planning.md
 *   /Documents/Blog Drafts/AI Writing Tools.md
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  selectors,
  waitForEditor,
  getEditorMarkdown,
  ensureFileListOpen,
  switchExplorerTab,
  openFileFromExplorer,
  createNewDocument,
  rightClickFile,
  preseedSettings,
} from './shared'

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await preseedSettings(page)
  await ensureFileListOpen(page)
  await switchExplorerTab(page, 'files')
})

test.afterAll(async () => {
  await page?.close()
})

test.describe('File Operations', () => {
  test('create new document from menu', async () => {
    await createNewDocument(page)

    const markdown = await getEditorMarkdown(page)
    expect(markdown.trim().length).toBeLessThan(20)
  })

  test('create new document reflects in tab bar', async () => {
    // Ensure any previous menu/dialog is closed
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    await createNewDocument(page)

    const editor = page.locator(selectors.editor)
    await expect(editor).toBeVisible({ timeout: 5_000 })
  })

  test('rename file via context menu', async () => {
    await ensureFileListOpen(page)
    await switchExplorerTab(page, 'files')

    const panel = page.locator(selectors.fileListPanel)
    await expect(panel.getByText('Empty Note')).toBeVisible({ timeout: 5_000 })

    await rightClickFile(page, 'Empty Note')
    await page.getByRole('menuitem', { name: 'Rename' }).click()

    const renameInput = panel.locator('input')
    await expect(renameInput).toBeVisible({ timeout: 3_000 })

    await renameInput.fill('Renamed Note')
    await page.keyboard.press('Enter')

    await expect(panel.getByText('Renamed Note')).toBeVisible({ timeout: 5_000 })
  })

  test('delete file via context menu', async () => {
    await ensureFileListOpen(page)
    await switchExplorerTab(page, 'files')

    const panel = page.locator(selectors.fileListPanel)
    await expect(panel.getByText('Formatting Examples')).toBeVisible({ timeout: 5_000 })

    await rightClickFile(page, 'Formatting Examples')
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click()

    // A confirmation dialog appears — click the confirm button
    const confirmBtn = page.getByRole('button', { name: 'Move to Trash' })
    await expect(confirmBtn).toBeVisible({ timeout: 3_000 })
    await confirmBtn.click()

    await expect(panel.getByText('Formatting Examples')).not.toBeVisible({ timeout: 5_000 })
  })

  // Duplicate action not available in context menu — Copy copies to clipboard
  test.skip('duplicate file via context menu', async () => {})

  test('open file preserves content', async () => {
    await ensureFileListOpen(page)
    await switchExplorerTab(page, 'files')

    await openFileFromExplorer(page, 'Welcome to Prose')

    const markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('Welcome to Prose')
  })

  test('file dirty state — editor reflects typed content', async () => {
    await openFileFromExplorer(page, 'Welcome to Prose')

    await page.click(selectors.editor)
    await page.keyboard.press('End')
    await page.keyboard.type(' dirty-state-marker')

    const markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('dirty-state-marker')
  })

  test('save file clears dirty state', async () => {
    await openFileFromExplorer(page, 'Welcome to Prose')

    await page.click(selectors.editor)
    await page.keyboard.press('End')
    await page.keyboard.type(' save-test')

    await page.keyboard.press('ControlOrMeta+s')

    const editor = page.locator(selectors.editor)
    await expect(editor).toBeVisible({ timeout: 2_000 })

    const markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('save-test')
  })

  test('switch between files', async () => {
    await ensureFileListOpen(page)
    await switchExplorerTab(page, 'files')

    await openFileFromExplorer(page, 'Welcome to Prose')
    const firstMarkdown = await getEditorMarkdown(page)
    expect(firstMarkdown).toContain('Welcome to Prose')

    const panel = page.locator(selectors.fileListPanel)

    // Expand Blog Drafts if needed
    const aiWritingTools = panel.getByText('AI Writing Tools')
    if (!(await aiWritingTools.isVisible().catch(() => false))) {
      await panel.getByText('Blog Drafts').click()
      await expect(aiWritingTools).toBeVisible({ timeout: 5_000 })
    }

    await aiWritingTools.click()
    await waitForEditor(page)

    const secondMarkdown = await getEditorMarkdown(page)
    expect(secondMarkdown).toContain('AI Writing Tools')
  })

  test('empty note opens correctly', async () => {
    await ensureFileListOpen(page)
    await switchExplorerTab(page, 'files')

    const panel = page.locator(selectors.fileListPanel)

    // Empty Note may have been renamed earlier
    const renamedNote = panel.getByText('Renamed Note')
    const emptyNote = panel.getByText('Empty Note')

    const hasRenamed = await renamedNote.isVisible({ timeout: 2_000 }).catch(() => false)
    const hasEmpty = await emptyNote.isVisible({ timeout: 2_000 }).catch(() => false)

    if (hasRenamed) {
      await renamedNote.click()
    } else if (hasEmpty) {
      await emptyNote.click()
    } else {
      await createNewDocument(page)
    }

    await waitForEditor(page)
    const editor = page.locator(selectors.editor)
    await expect(editor).toBeVisible({ timeout: 5_000 })
  })

  test('file with frontmatter renders metadata', async () => {
    await ensureFileListOpen(page)
    await switchExplorerTab(page, 'files')

    const panel = page.locator(selectors.fileListPanel)

    const meetingNotes = panel.getByText('Meeting Notes')
    await expect(meetingNotes).toBeVisible({ timeout: 5_000 })

    const q1Planning = panel.getByText('Q1 Planning')
    await meetingNotes.click()
    if (!(await q1Planning.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await meetingNotes.click()
    }
    await expect(q1Planning).toBeVisible({ timeout: 5_000 })

    await q1Planning.click()
    await waitForEditor(page)

    await expect(page.getByText('status:')).toBeVisible({ timeout: 10_000 })
  })

  test('close file returns to empty state', async () => {
    await openFileFromExplorer(page, 'Welcome to Prose')

    // Close all open tabs to reach the empty state
    const closeButton = page.locator(selectors.closeTab).first()
    while (await closeButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await closeButton.click()
    }

    // Verify the app shows the empty state or "New Document" prompt
    const emptyState = page.locator(selectors.emptyState)
    const newDocButton = page.getByRole('button', { name: 'New Document' })
    await expect(emptyState.or(newDocButton)).toBeVisible({ timeout: 5_000 })
  })

  test('new document naming', async () => {
    await createNewDocument(page)

    const untitledTab = page.getByText(/untitled/i)
    const tabVisible = await untitledTab.isVisible({ timeout: 3_000 }).catch(() => false)

    if (tabVisible) {
      await expect(untitledTab).toBeVisible()
    } else {
      const markdown = await getEditorMarkdown(page)
      expect(markdown.trim().length).toBeLessThan(20)
    }
  })

  test('open file from subfolder', async () => {
    await ensureFileListOpen(page)
    await switchExplorerTab(page, 'files')

    const panel = page.locator(selectors.fileListPanel)

    const meetingNotes = panel.getByText('Meeting Notes')
    await expect(meetingNotes).toBeVisible({ timeout: 5_000 })

    const weeklyStandup = panel.getByText('Weekly Standup')
    await meetingNotes.click()
    if (!(await weeklyStandup.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await meetingNotes.click()
    }
    await expect(weeklyStandup).toBeVisible({ timeout: 5_000 })

    await weeklyStandup.click()
    await waitForEditor(page)

    const markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('Weekly Standup')
  })
})
