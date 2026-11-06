/**
 * Electron Favorites context-menu regression — covers PROSE-J / issue #777.
 *
 * The bug: `ReferenceError: onAddFavorite is not defined` crashed the file-tree
 * when the "Add to Favorites" context-menu item was clicked. Root cause was an
 * undeclared `onFileMove` prop (TypeScript gap) and missing defensive guards on
 * optional callbacks in FileTree/FileTreeItem.
 *
 * This test verifies that right-clicking a file in the file tree and selecting
 * "Add to Favorites" does NOT crash, and that the item subsequently appears in
 * the Favorites view.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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
let qaDocDir: string

const DOC_NAME = 'qa-favorites-test.md'
const DOC_DISPLAY = 'qa-favorites-test'

// View toggles live on the header bar OR overflow into the ⋯ menu depending on
// panel width (CustomizableToolbar, #701). Click the bar button when present,
// otherwise open ⋯ and pick the menu item.
async function selectFileView(label: string): Promise<void> {
  const direct = page.locator(`[data-testid="file-list-panel"] [aria-label="${label}"]`)
  if (await direct.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await direct.click()
  } else {
    await page.locator('[data-testid="file-list-panel"] [aria-label="More options"]').click()
    await page.getByRole('menuitem', { name: label }).click()
  }
}

test.beforeAll(async () => {
  test.setTimeout(90_000)

  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-favorites-profile-'))
  qaDocDir = mkdtempSync(join(tmpdir(), 'prose-qa-favorites-docs-'))
  mkdirSync(qaDocDir, { recursive: true })
  writeFileSync(join(qaDocDir, DOC_NAME), '# Favorites regression test\n')

  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', icon: 'pilcrow' },
        defaultSaveDirectory: qaDocDir,
        favorites: [],
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
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocDir, { recursive: true, force: true })
})

test.describe('Electron — Favorites context menu (PROSE-J regression)', () => {
  test('Add to Favorites via file-tree right-click does not crash', async () => {
    // Collect any uncaught page errors so we can assert none occurred
    const pageErrors: Error[] = []
    page.on('pageerror', (err) => pageErrors.push(err))

    await ensureFileListOpen(page)
    const panel = page.locator(selectors.fileListPanel)

    // Switch to the Files tab (folder view) so the FileTree is rendered
    await selectFileView('Files')

    // Wait for the test document to appear in the file tree
    await expect(panel.getByText(DOC_DISPLAY)).toBeVisible({ timeout: 10_000 })

    // Right-click the file to open the context menu
    await panel.getByText(DOC_DISPLAY).click({ button: 'right' })
    await page.waitForSelector(selectors.contextMenu, { timeout: 5_000 })

    // The context menu must include "Add to Favorites"
    const addToFav = page.getByRole('menuitem', { name: 'Add to Favorites' })
    await expect(addToFav).toBeVisible({ timeout: 3_000 })

    // Click it — this was the crash site (ReferenceError: onAddFavorite is not defined)
    await addToFav.click()

    // Wait a moment for any async state update to settle
    await page.waitForTimeout(500)

    // Assert no uncaught errors were thrown
    const favErrors = pageErrors.filter((e) => e.message.includes('onAddFavorite'))
    expect(favErrors, 'onAddFavorite ReferenceError must not be thrown').toHaveLength(0)
    const anyErrors = pageErrors.filter((e) => /ReferenceError|TypeError/.test(e.message))
    expect(anyErrors, 'No uncaught ReferenceError or TypeError should occur').toHaveLength(0)
  })

  test('Favorited file appears in the Favorites view', async () => {
    // Switch to the Favorites tab
    await selectFileView('Favorites')

    const panel = page.locator(selectors.fileListPanel)

    // The document should now appear in the Favorites list
    await expect(panel.getByText(DOC_DISPLAY)).toBeVisible({ timeout: 5_000 })

    // "No favorites yet." placeholder must be gone
    await expect(panel.getByText('No favorites yet.')).not.toBeVisible()
  })

  test('Remove from Favorites via file-tree right-click does not crash', async () => {
    const pageErrors: Error[] = []
    page.on('pageerror', (err) => pageErrors.push(err))

    // Go back to Files view
    await selectFileView('Files')

    const panel = page.locator(selectors.fileListPanel)
    await expect(panel.getByText(DOC_DISPLAY)).toBeVisible({ timeout: 10_000 })

    // Right-click the file again — it's now a favorite, so menu should show "Remove from Favorites"
    await panel.getByText(DOC_DISPLAY).click({ button: 'right' })
    await page.waitForSelector(selectors.contextMenu, { timeout: 5_000 })

    const removeFromFav = page.getByRole('menuitem', { name: 'Remove from Favorites' })
    await expect(removeFromFav).toBeVisible({ timeout: 3_000 })
    await removeFromFav.click()

    await page.waitForTimeout(500)

    const removeErrors = pageErrors.filter((e) => /onRemoveFavorite|ReferenceError/.test(e.message))
    expect(removeErrors, 'No errors thrown on Remove from Favorites').toHaveLength(0)
  })

  test('Favorites view is empty after removal', async () => {
    await selectFileView('Favorites')
    const panel = page.locator(selectors.fileListPanel)
    await expect(panel.getByText('No favorites yet.')).toBeVisible({ timeout: 5_000 })
    await expect(panel.getByText(DOC_DISPLAY)).not.toBeVisible()
  })
})
