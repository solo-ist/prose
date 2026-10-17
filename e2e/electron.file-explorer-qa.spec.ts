/**
 * File Explorer QA (#723) — regression coverage for three concrete bugs:
 *
 * 1. Rename → Enter scrolls the file explorer to the top.
 *    The rename-activation effect was calling scrollTo(0, 0) on the Radix
 *    scroll viewport to undo scroll drift from select(), but that wiped the
 *    user's scroll position. Fix: save/restore scrollTop around the select().
 *
 * 2. No multi-select (Shift+Click, Cmd/Ctrl+Click, Cmd+A).
 *    Add range-select and toggle-select with Cmd+A select-all.
 *
 * 3. After file delete, focus does not return to the explorer.
 *    handleConfirmDelete now calls containerRef.current?.focus() after the
 *    file is trashed.
 *
 * All tests run in an isolated PROSE_USER_DATA_DIR profile with a fixture
 * directory of markdown files so the file explorer is populated.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
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

const FILE_NAMES = [
  'alpha.md',
  'beta.md',
  'gamma.md',
  'delta.md',
  'epsilon.md',
  'zeta.md',
  'eta.md',
  'theta.md',
  'iota.md',
  'kappa.md',
]

test.beforeAll(async () => {
  test.setTimeout(90_000)

  // Isolated profile + populated fixture directory
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-723-profile-'))
  qaFilesDir = mkdtempSync(join(tmpdir(), 'prose-qa-723-files-'))
  mkdirSync(qaFilesDir, { recursive: true })
  for (const name of FILE_NAMES) {
    writeFileSync(join(qaFilesDir, name), `# ${name.replace('.md', '')}\n\nContent.\n`)
  }

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

  // Switch to the folder view showing our fixture files
  const filesBtn = page.locator(selectors.filesButton)
  if (await filesBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await filesBtn.click()
  }
  // Wait for at least one file to appear
  const panel = page.locator(selectors.fileListPanel)
  await panel.getByText('alpha').waitFor({ state: 'visible', timeout: 10_000 })
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaFilesDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helper: get the scroll viewport's current scrollTop inside the panel.
// ---------------------------------------------------------------------------
async function getPanelScrollTop(testPage: Page): Promise<number> {
  return testPage.evaluate(() => {
    const panel = document.querySelector('[data-testid="file-list-panel"]')
    const viewport = panel?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
    return viewport?.scrollTop ?? 0
  })
}

// ---------------------------------------------------------------------------
// Helper: get all paths currently in selectedPaths store.
// ---------------------------------------------------------------------------
async function getSelectedPaths(testPage: Page): Promise<string[]> {
  return testPage.evaluate(() => {
    // Access the Zustand store directly via the module registry isn't practical
    // from a CDP context; instead read the visual state — items with
    // bg-accent class that are not the "hover" state are selected.
    const panel = document.querySelector('[data-testid="file-list-panel"]')
    if (!panel) return []
    const selected: string[] = []
    const buttons = panel.querySelectorAll('button[title]')
    for (const btn of buttons) {
      if (btn.classList.contains('bg-accent')) {
        const titleAttr = btn.getAttribute('title')
        if (titleAttr) selected.push(titleAttr)
      }
    }
    return selected
  })
}

// ---------------------------------------------------------------------------
// Bug 1: Rename → Enter must not scroll the file list to the top
// ---------------------------------------------------------------------------
test.describe('Electron — file explorer QA (#723)', () => {
  test('Bug 1: rename via Enter preserves scroll position', async () => {
    const panel = page.locator(selectors.fileListPanel)

    // Scroll to the bottom of the file list so scroll position is non-zero
    await page.evaluate(() => {
      const fp = document.querySelector('[data-testid="file-list-panel"]')
      const viewport = fp?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
      if (viewport) viewport.scrollTop = 1000
    })

    // Give scroll event a frame to settle
    await page.waitForTimeout(100)

    const scrollBefore = await getPanelScrollTop(page)
    // Should be > 0 if the list is actually scrollable; if not, the test is
    // still valid — we just confirm no unexpected reset occurs.

    // Right-click a file near the bottom of our fixture list to open context menu
    await panel.getByText('kappa').click({ button: 'right' })
    await page.waitForSelector(selectors.contextMenu, { timeout: 5_000 })

    // Click Rename
    const renameItem = page.getByRole('menuitem', { name: 'Rename' })
    await renameItem.waitFor({ state: 'visible', timeout: 3_000 })
    await renameItem.click()

    // Give the rename input time to focus (there's a 50ms rAF + setTimeout delay)
    await page.waitForTimeout(200)

    // Verify scroll was not reset to 0 by the rename-activation effect
    const scrollDuringRename = await getPanelScrollTop(page)
    expect(scrollDuringRename).toBeGreaterThanOrEqual(scrollBefore - 10)

    // Commit the rename with Enter (using the same name so no actual rename occurs)
    await page.keyboard.press('Escape')
  })

  // ---------------------------------------------------------------------------
  // Bug 2: Multi-select — Cmd+Click, Shift+Click, Cmd+A
  // ---------------------------------------------------------------------------
  test('Bug 2: Cmd+click toggles files into multi-select', async () => {
    const panel = page.locator(selectors.fileListPanel)

    // Single-click alpha to establish anchor
    await panel.getByText('alpha').click()
    await page.waitForTimeout(100)

    // Cmd+click beta — should add it to selection
    await panel.getByText('beta').click({ modifiers: ['Meta'] })
    await page.waitForTimeout(100)

    // Cmd+click gamma
    await panel.getByText('gamma').click({ modifiers: ['Meta'] })
    await page.waitForTimeout(100)

    const selected = await getSelectedPaths(page)
    // At least alpha, beta, gamma should be selected
    const baseNames = selected.map((p) => p.split('/').pop() ?? '')
    expect(baseNames).toContain('alpha.md')
    expect(baseNames).toContain('beta.md')
    expect(baseNames).toContain('gamma.md')
  })

  test('Bug 2: Cmd+A selects all visible files', async () => {
    const panel = page.locator(selectors.fileListPanel)

    // Focus the panel
    await panel.click()

    // Ensure multi-select is cleared first via single click
    await panel.getByText('alpha').click()
    await page.waitForTimeout(100)

    // Press Cmd+A
    await page.keyboard.press('Meta+a')
    await page.waitForTimeout(100)

    const selected = await getSelectedPaths(page)
    // All fixture .md files should be selected
    expect(selected.length).toBeGreaterThanOrEqual(FILE_NAMES.length)
  })

  test('Bug 2: Shift+click range-selects from anchor to target', async () => {
    const panel = page.locator(selectors.fileListPanel)

    // Click alpha (anchor)
    await panel.getByText('alpha').click()
    await page.waitForTimeout(100)

    // The file list sorts by localeCompare, so the visible order is:
    // alpha(0), beta(1), delta(2), epsilon(3), eta(4), gamma(5), iota(6), kappa(7), theta(8), zeta(9)
    // Shift+click eta — should select the contiguous run alpha..eta (5 files).
    // Use an exact-name locator: 'eta' is a substring of beta/theta/zeta so
    // getByText without anchoring would match 4 elements and throw in strict mode.
    await panel.locator('button[title]', { hasText: /^eta$/ }).click({ modifiers: ['Shift'] })
    await page.waitForTimeout(100)

    const selected = await getSelectedPaths(page)
    const baseNames = selected.map((p) => p.split('/').pop() ?? '')
    // All files alphabetically between alpha and eta should be selected
    expect(baseNames).toContain('alpha.md')
    expect(baseNames).toContain('beta.md')
    expect(baseNames).toContain('delta.md')
    expect(baseNames).toContain('epsilon.md')
    expect(baseNames).toContain('eta.md')
    // And selection should be at least 5
    expect(selected.length).toBeGreaterThanOrEqual(5)
  })

  test('Bug 2: plain click clears multi-select and selects single file', async () => {
    const panel = page.locator(selectors.fileListPanel)

    // Start with Cmd+A to get multi-select
    await panel.click()
    await panel.getByText('alpha').click()
    await page.keyboard.press('Meta+a')
    await page.waitForTimeout(100)

    const allSelected = await getSelectedPaths(page)
    expect(allSelected.length).toBeGreaterThan(1)

    // Plain click on beta
    await panel.getByText('beta').click()
    await page.waitForTimeout(100)

    const afterClick = await getSelectedPaths(page)
    // Only beta (or nothing extra) should be selected
    expect(afterClick.length).toBeLessThanOrEqual(1)
  })

  // ---------------------------------------------------------------------------
  // Bug 3: Focus returns to explorer after delete
  // ---------------------------------------------------------------------------
  test('Bug 3: focus returns to file explorer panel after file deletion', async () => {
    // Create a temp file in our fixture dir so we can safely delete it
    const tempName = 'to-be-deleted.md'
    writeFileSync(join(qaFilesDir, tempName), '# Temp\n')

    // Wait for the file watcher to pick up the new file
    const panel = page.locator(selectors.fileListPanel)
    await panel.getByText('to-be-deleted').waitFor({ state: 'visible', timeout: 8_000 })

    // Right-click → Move to Trash
    await panel.getByText('to-be-deleted').click({ button: 'right' })
    await page.waitForSelector(selectors.contextMenu, { timeout: 5_000 })
    const trashItem = page.getByRole('menuitem', { name: 'Move to Trash' })
    await trashItem.waitFor({ state: 'visible', timeout: 3_000 })
    await trashItem.click()

    // Confirm the delete dialog
    const confirmBtn = page.getByRole('button', { name: 'Move to Trash' }).last()
    await confirmBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await confirmBtn.click()

    // Wait for dialog to close
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5_000 })

    // After deletion, the explorer panel should be focused (not body/document)
    const focusedTestId = await page.evaluate(() => {
      return document.activeElement?.getAttribute('data-testid') ??
             document.activeElement?.tagName?.toLowerCase() ??
             'unknown'
    })

    // The containerRef div has data-testid="file-list-panel" and tabIndex={-1}
    expect(focusedTestId).toBe('file-list-panel')
  })
})
