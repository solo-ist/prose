/**
 * The delivered Prose mark, in-app (#1063).
 *
 * Three placeholders predated the real art: the About dialog showed a stale
 * green "P" PNG from before the current identity, the empty state drew a generic
 * lucide pencil, and the mark itself was *synthesized* — a `¶` set in Fraunces
 * inside a CSS squircle, screenshotted through Playwright Chromium at build
 * time. That last one made the app's identity depend on a Google Fonts fetch and
 * a browser install, and meant `npm run icons` could not run at all on a machine
 * where the Playwright browser install had failed.
 *
 * These tests pin the two surfaces, plus the two build-level dependencies that
 * are easy to reintroduce by accident and invisible until a build breaks.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay } from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

let app: ElectronApplication
let page: Page
let userDataDir: string
let filesDir: string

type SeamWindow = Window & {
  __prose_about?: (open?: boolean) => void
  __prose_setEditing?: (v: boolean) => void
}

test.beforeAll(async () => {
  test.setTimeout(90_000)
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-mark-'))
  filesDir = mkdtempSync(join(tmpdir(), 'prose-qa-mark-files-'))
  writeFileSync(join(filesDir, 'notes.md'), '# Notes\n')
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      appearance: { mode: 'dark', icon: 'pilcrow' },
      defaultSaveDirectory: filesDir,
      aiConsent: { consented: true, consentedAt: '2026-01-01T00:00:00.000Z', version: 1 },
      fileAssociation: { hasBeenPrompted: true },
    }),
  )
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(filesDir, { recursive: true, force: true })
})

test.describe('Electron — the Prose mark (#1063)', () => {
  test('the About dialog shows the mark, not the stale PNG', async () => {
    await page.evaluate(() => (window as unknown as SeamWindow).__prose_about?.(true))
    const dialog = page.locator('[role="dialog"]').filter({ hasText: 'Prose' })
    await expect(dialog.locator('[data-testid="prose-mark"]')).toBeVisible({ timeout: 10_000 })
    // The old implementation was two <img> tags swapped by theme.
    await expect(dialog.locator('img')).toHaveCount(0)
    await page.evaluate(() => (window as unknown as SeamWindow).__prose_about?.(false))
    // Let the close animation finish before the next test looks at the page.
    await expect(dialog).toBeHidden()
  })

  test('the empty state shows the mark instead of the pencil', async () => {
    // EmptyState renders only with no document AND editorStore.isEditing false.
    await page.evaluate(() => (window as unknown as SeamWindow).__prose_setEditing?.(false))
    await expect(page.getByText('Start Writing')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="prose-mark"]')).toBeVisible()
  })

  test('rendering the mark needs no web font', () => {
    // The glyph was a ¶ in Fraunces; as a path it depends on nothing loading.
    // Match the font DECLARATION, not the word — the file explains in a comment
    // what it used to do, and that comment should not fail the test.
    const icons = readFileSync(join(ROOT, 'src/renderer/lib/prose-icons.tsx'), 'utf-8')
    expect(icons).not.toMatch(/fontFamily:\s*'"Fraunces"/)
  })

  test('building the icons needs no browser', () => {
    // `npm run icons` drove Playwright Chromium, so it could not run on a machine
    // whose browser install had failed — which is the machine it is needed on.
    const script = readFileSync(join(ROOT, 'scripts/build-icons.mjs'), 'utf-8')
    expect(script).not.toMatch(/from '@?playwright/)
    expect(script).not.toMatch(/\bchromium\b\s*[.(]/)
    // And the master it resamples has to actually be committed.
    expect(existsSync(join(ROOT, 'resources/icons/pilcrow/icon-1024.png'))).toBe(true)
  })
})
