import { test, expect, type Page } from '@playwright/test'

/**
 * Dismiss the AI consent dialog if it appears on first load.
 * Prose shows this dialog when no consent has been given yet (fresh browser context).
 */
async function dismissAIConsent(page: Page) {
  const consentDialog = page.getByRole('alertdialog').filter({ hasText: 'AI Writing Assistance' })
  const appeared = await consentDialog.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false)
  if (appeared) {
    await page.getByRole('button', { name: 'Enable AI Features' }).click()
    await consentDialog.waitFor({ state: 'hidden' })
  }
}

/**
 * Wait for the app to finish initializing (editor mount + settings load).
 */
async function waitForAppReady(page: Page) {
  // Toolbar is the earliest stable landmark
  await page.locator('[aria-label="Toggle theme"]').waitFor({ state: 'visible', timeout: 15_000 })
  await dismissAIConsent(page)
}

// ---------------------------------------------------------------------------
// Test 1: App loads without console errors
// ---------------------------------------------------------------------------

test('app loads without console errors', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  await page.goto('/')
  await waitForAppReady(page)

  // Filter out known-benign errors (e.g. favicon 404, IndexedDB warnings)
  const realErrors = consoleErrors.filter(
    (msg) =>
      !msg.includes('favicon') &&
      !msg.includes('Failed to load resource') &&
      !msg.includes('net::ERR_') &&
      !msg.includes('ResizeObserver')
  )

  expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// Test 2: File explorer renders fixture files
// ---------------------------------------------------------------------------

test('file explorer renders fixture files', async ({ page }) => {
  await page.goto('/')
  await waitForAppReady(page)

  // Open the file list panel
  const showFilesBtn = page.getByRole('button', { name: /show files/i })
  await showFilesBtn.click()

  // The file list panel should become visible
  // The default view after opening should show the /Documents folder populated
  // by fixture files. Wait for at least one known fixture file to appear.
  await expect(page.getByText('Welcome to Prose.md')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Formatting Examples.md')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Test 3: Clicking a file loads content into the editor
// ---------------------------------------------------------------------------

test('clicking a file loads content into editor', async ({ page }) => {
  await page.goto('/')
  await waitForAppReady(page)

  // Open file list panel
  await page.getByRole('button', { name: /show files/i }).click()
  await expect(page.getByText('Welcome to Prose.md')).toBeVisible({ timeout: 10_000 })

  // Click the file
  await page.getByText('Welcome to Prose.md').click()

  // The editor should contain the file content
  const editor = page.locator('.ProseMirror')
  await expect(editor).toBeVisible({ timeout: 5_000 })
  await expect(editor).toContainText('Welcome to Prose', { timeout: 5_000 })
})

// ---------------------------------------------------------------------------
// Test 4: Editor accepts text input
// ---------------------------------------------------------------------------

test('editor accepts text input', async ({ page }) => {
  await page.goto('/')
  await waitForAppReady(page)

  const editor = page.locator('.ProseMirror')
  await expect(editor).toBeVisible({ timeout: 10_000 })

  // Click the editor to focus it, then type
  await editor.click()
  await page.keyboard.type('Hello Playwright')

  await expect(editor).toContainText('Hello Playwright')
})

// ---------------------------------------------------------------------------
// Test 5: Settings panel opens
// ---------------------------------------------------------------------------

test('settings panel opens', async ({ page }) => {
  await page.goto('/')
  await waitForAppReady(page)

  // Open "More options" menu and click Settings
  await page.getByRole('button', { name: /more options/i }).click()
  await page.getByRole('menuitem', { name: /settings/i }).click()

  // Settings dialog should appear
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('dialog')).toContainText('Settings')
})

// ---------------------------------------------------------------------------
// Test 6: Theme toggle works
// ---------------------------------------------------------------------------

test('theme toggle switches between light and dark', async ({ page }) => {
  await page.goto('/')
  await waitForAppReady(page)

  const html = page.locator('html')

  // App starts in dark mode by default
  await expect(html).toHaveClass(/dark/, { timeout: 5_000 })

  // Toggle to light
  await page.getByRole('button', { name: /toggle theme/i }).click()
  await expect(html).not.toHaveClass(/dark/)

  // Toggle back to dark
  await page.getByRole('button', { name: /toggle theme/i }).click()
  await expect(html).toHaveClass(/dark/)
})
