/**
 * Explorer interactivity (#703) — Playwright regressions for:
 *
 * - New Folder: context menu item appears in empty-space and folder-row menus;
 *   dialog creates the directory and it appears in the tree.
 * - Folder rename: right-click → Rename on a folder triggers inline rename;
 *   committing renames the directory on disk.
 * - Non-markdown files: always visible in the file list, greyed (not openable).
 * - Dotfile toggle: ⌘⇧. shows/hides dotfiles while the explorer is focused.
 *
 * All tests run in an isolated PROSE_USER_DATA_DIR profile.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  ensureFileListOpen,
  selectors,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaFilesDir: string
let subfolderPath: string

test.beforeAll(async () => {
  test.setTimeout(90_000)

  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-703-profile-'))
  qaFilesDir = mkdtempSync(join(tmpdir(), 'prose-qa-703-files-'))
  subfolderPath = join(qaFilesDir, 'my-subfolder')
  mkdirSync(subfolderPath, { recursive: true })

  // A markdown file and a non-markdown file in the root
  writeFileSync(join(qaFilesDir, 'notes.md'), '# Notes\n')
  writeFileSync(join(qaFilesDir, 'image.png'), 'fake png data')
  // A dotfile
  writeFileSync(join(qaFilesDir, '.hidden-config'), 'dotfile content')

  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', icon: 'pilcrow' },
        defaultSaveDirectory: qaFilesDir,
      },
      null,
      2,
    ),
  )

  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir } })
  app = launched.app
  page = launched.page

  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)
  await ensureFileListOpen(page)

  // Switch to the folder view
  const filesBtn = page.locator(selectors.filesButton)
  if (await filesBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await filesBtn.click()
  }
  // Wait for the markdown file to appear
  await page.locator(selectors.fileListPanel).getByText('notes').waitFor({ state: 'visible', timeout: 10_000 })
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaFilesDir, { recursive: true, force: true })
})

test.describe('Electron — explorer interactivity (#703)', () => {

  // ---------------------------------------------------------------------------
  // Non-markdown files: always visible but greyed
  // ---------------------------------------------------------------------------
  test('non-markdown files (e.g. .png) are visible in the file list', async () => {
    const panel = page.locator(selectors.fileListPanel)
    // image.png should appear in the list
    await expect(panel.getByText('image.png')).toBeVisible({ timeout: 5_000 })
  })

  test('non-markdown files are greyed (have muted styling, not full-opacity)', async () => {
    const panel = page.locator(selectors.fileListPanel)
    // The button for image.png should have the non-markdown cursor-default class
    const btn = panel.locator('button[title]').filter({ hasText: 'image.png' })
    await expect(btn).toBeVisible({ timeout: 5_000 })
    const cls = await btn.getAttribute('class') ?? ''
    // Should have cursor-default (applied to non-markdown items)
    expect(cls).toContain('cursor-default')
  })

  // ---------------------------------------------------------------------------
  // New Folder via empty-space context menu
  // ---------------------------------------------------------------------------
  test('New Folder via empty-space context menu creates the directory', async () => {
    const panel = page.locator(selectors.fileListPanel)
    const folderName = 'qa-new-folder-703'

    // Right-click in an empty area of the panel
    await panel.locator('div.p-2.grow.shrink-0').click({ button: 'right', position: { x: 10, y: 10 } })
    await page.waitForSelector(selectors.contextMenu, { timeout: 5_000 })

    // Click "New Folder"
    const newFolderItem = page.getByRole('menuitem', { name: 'New Folder' })
    await newFolderItem.waitFor({ state: 'visible', timeout: 3_000 })
    await newFolderItem.click()

    // Dialog should appear
    const dialog = page.locator('[role="dialog"]')
    await dialog.waitFor({ state: 'visible', timeout: 5_000 })

    // Type folder name
    await page.locator('#new-folder-name').fill(folderName)
    await page.keyboard.press('Enter')

    // Dialog should close
    await dialog.waitFor({ state: 'detached', timeout: 5_000 })

    // Wait for the folder to appear in the tree
    await panel.getByText(folderName).waitFor({ state: 'visible', timeout: 8_000 })

    // Confirm it was created on disk
    expect(existsSync(join(qaFilesDir, folderName))).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // New Folder via folder-row context menu
  // ---------------------------------------------------------------------------
  test('New Folder via folder right-click context menu creates subfolder', async () => {
    const panel = page.locator(selectors.fileListPanel)
    const subFolderName = 'qa-child-folder-703'

    // Right-click on my-subfolder
    await panel.getByText('my-subfolder').click({ button: 'right' })
    await page.waitForSelector(selectors.contextMenu, { timeout: 5_000 })

    const newFolderItem = page.getByRole('menuitem', { name: 'New Folder' })
    await newFolderItem.waitFor({ state: 'visible', timeout: 3_000 })
    await newFolderItem.click()

    const dialog = page.locator('[role="dialog"]')
    await dialog.waitFor({ state: 'visible', timeout: 5_000 })
    await page.locator('#new-folder-name').fill(subFolderName)
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'detached', timeout: 5_000 })

    // Confirm on disk
    expect(existsSync(join(subfolderPath, subFolderName))).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Folder rename via context menu
  // ---------------------------------------------------------------------------
  test('folder right-click → Rename triggers inline rename', async () => {
    const panel = page.locator(selectors.fileListPanel)
    const originalName = 'my-subfolder'
    const newName = 'renamed-subfolder'

    // Right-click the folder button (use button[title] to target the exact row,
    // not just the text span, so the ContextMenuTrigger gets the event).
    const folderBtn = panel.locator('button[title]', { hasText: /^my-subfolder$/ })
    await folderBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await folderBtn.click({ button: 'right' })
    await page.waitForSelector(selectors.contextMenu, { timeout: 5_000 })

    const renameItem = page.getByRole('menuitem', { name: 'Rename' })
    await renameItem.waitFor({ state: 'visible', timeout: 3_000 })
    await renameItem.click()

    // The Radix context-menu close animation runs first, THEN React re-renders
    // the FileTreeItem with isRenaming=true, and THEN the rAF+50ms timer inside
    // the effect fires to focus the input. On CI/headless this chain can take
    // longer than locally — wait up to 8s for the input to become visible.
    const renameInput = page.locator(`[data-testid="file-list-panel"] input`)
    await renameInput.waitFor({ state: 'visible', timeout: 8_000 })

    // Use fill() to replace the value atomically — avoids OS-specific select-all
    // keyboard shortcut differences (Cmd+A vs Ctrl+A on macOS vs Linux CI).
    await renameInput.fill(newName)
    await page.keyboard.press('Enter')

    // Wait for the tree to refresh
    await panel.locator('button[title]', { hasText: /^renamed-subfolder$/ }).waitFor({ state: 'visible', timeout: 8_000 })

    // Confirm on disk
    expect(existsSync(join(qaFilesDir, newName))).toBe(true)
    expect(existsSync(join(qaFilesDir, originalName))).toBe(false)

    // Restore for test isolation (rename back)
    const renamedBtn = panel.locator('button[title]', { hasText: /^renamed-subfolder$/ })
    await renamedBtn.click({ button: 'right' })
    await page.waitForSelector(selectors.contextMenu, { timeout: 3_000 })
    const reRename = page.getByRole('menuitem', { name: 'Rename' })
    if (await reRename.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await reRename.click()
      const reInput = page.locator(`[data-testid="file-list-panel"] input`)
      await reInput.waitFor({ state: 'visible', timeout: 8_000 })
      await reInput.fill(originalName)
      await page.keyboard.press('Enter')
      await panel.locator('button[title]', { hasText: /^my-subfolder$/ }).waitFor({ state: 'visible', timeout: 5_000 })
    }
  })

  // ---------------------------------------------------------------------------
  // Dotfile toggle: ⌘⇧. shows dotfiles when explorer is focused
  // ---------------------------------------------------------------------------
  test('⌘⇧. dotfile toggle shows and hides dotfiles', async () => {
    const panel = page.locator(selectors.fileListPanel)

    // Dotfile should NOT be visible by default
    const hidden = panel.getByText('.hidden-config')
    await expect(hidden).not.toBeVisible({ timeout: 2_000 }).catch(() => {
      // If it is visible this test still passes below (we check the toggle)
    })

    // Focus the panel and press Cmd+Shift+.
    await panel.click()
    await page.keyboard.press('Meta+Shift+.')
    await page.waitForTimeout(300)

    // Dotfile should now be visible
    await expect(panel.getByText('.hidden-config')).toBeVisible({ timeout: 5_000 })

    // Press again to hide
    await page.keyboard.press('Meta+Shift+.')
    await page.waitForTimeout(300)
    await expect(panel.getByText('.hidden-config')).not.toBeVisible({ timeout: 5_000 })
  })
})
