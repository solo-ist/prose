/**
 * #654 — MAS bookmark architecture regression tests (desktop-runnable slice).
 *
 * The MAS sandbox itself (startAccessingSecurityScopedResource) can't run on
 * the desktop build; what IS testable deterministically is the settings-level
 * contract the fix establishes:
 *
 *  1. Switching projects must NOT write the project's bookmark into the legacy
 *     masDirectoryBookmark slot — that slot belongs exclusively to the base
 *     root, and the v1.6.0–v1.6.2 sync destroyed the base root's only bookmark
 *     (negative control: fails on the pre-#654 code).
 *  2. A profile poisoned by that sync (masDirectoryBookmark === a project's
 *     bookmark) is healed on load: the slot and the now-inaccessible
 *     defaultSaveDirectory are cleared, and the heal is persisted.
 *
 * Isolated PROSE_USER_DATA_DIR profile per test.
 */

import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitForAppReady, dismissOnboarding, dismissOverlay } from './helpers'

// Launch out/main/index.js directly (the electron.screenshots pattern) instead
// of helpers.launchApp — launchApp prefers a packaged build under dist/, which
// locally can be a months-stale app that doesn't contain the code under test.
const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')

const BASE_BOOKMARK = 'QkFTRS1CT09LTUFSSw=='    // "BASE-BOOKMARK"
const PROJECT_BOOKMARK = 'UFJPSi1CT09LTUFSSw==' // "PROJ-BOOKMARK"
const PROJECT_ID = '00000000-0000-4000-8000-000000000001'

let app: ElectronApplication | undefined
let page: Page
let profile: string
let docsDir: string

function seedProfile(settings: object): void {
  profile = mkdtempSync(join(tmpdir(), 'prose-654-profile-'))
  writeFileSync(join(profile, 'settings.json'), JSON.stringify(settings, null, 2))
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))
}

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [join(REPO, 'out/main/index.js')],
    env: { ...(process.env as Record<string, string>), PROSE_USER_DATA_DIR: profile }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)
}

/** Reveal the files panel (hidden by default in a fresh profile) and open the
 *  Projects view — direct toggle first, overflow menu fallback at narrow widths
 *  (same locators as electron.screenshots.spec.ts). */
async function openProjectsView(): Promise<void> {
  const show = page.locator('[aria-label="Show files"]')
  if (await show.isVisible({ timeout: 1_000 }).catch(() => false)) await show.click()
  await page.waitForTimeout(300)

  const btn = page.locator('[aria-label="Projects"]')
  if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await btn.click()
  } else {
    await page.locator('[aria-label="More views"]').click()
    await page.getByRole('menuitem', { name: 'Projects' }).click()
  }
  await page.waitForTimeout(400)
}

test.afterEach(async () => {
  await app?.close()
  app = undefined
  rmSync(profile, { recursive: true, force: true })
  rmSync(docsDir, { recursive: true, force: true })
})

test('switching projects leaves the base-root bookmark slot untouched', async () => {
  docsDir = mkdtempSync(join(tmpdir(), 'prose-654-docs-'))
  const baseDir = join(docsDir, 'Base')
  const projDir = join(docsDir, 'Essays')
  mkdirSync(baseDir, { recursive: true })
  mkdirSync(projDir, { recursive: true })
  writeFileSync(join(projDir, 'Draft.md'), '# Draft\n')

  seedProfile({
    appearance: { color: 'mono', mode: 'dark', icon: 'pilcrow', migrationToastShown: true },
    defaultSaveDirectory: baseDir,
    masDirectoryBookmark: BASE_BOOKMARK,
    projects: [
      {
        id: PROJECT_ID,
        name: 'Essays',
        path: projDir,
        bookmark: PROJECT_BOOKMARK,
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
  })
  await launch()

  // Open the Projects view and switch into the seeded project.
  await openProjectsView()
  await page.getByRole('button', { name: /Essays/ }).first().click()

  // switchToProject persists lastOpenedAt — wait for that write to land…
  await expect
    .poll(
      () => {
        const projects = readSettings().projects as Array<{ lastOpenedAt?: string }> | undefined
        return projects?.[0]?.lastOpenedAt ?? null
      },
      { timeout: 10_000 },
    )
    .not.toBeNull()

  // …then assert the base root's bookmark survived the switch. The pre-#654
  // sync overwrote it with PROJECT_BOOKMARK at exactly this point.
  const settings = readSettings()
  expect(settings.masDirectoryBookmark).toBe(BASE_BOOKMARK)
  expect(settings.defaultSaveDirectory).toBe(baseDir)
  expect(settings.activeProjectId).toBe(PROJECT_ID)
})

test('a poisoned bookmark slot (project bookmark in masDirectoryBookmark) is healed on load', async () => {
  docsDir = mkdtempSync(join(tmpdir(), 'prose-654-docs-'))
  const baseDir = join(docsDir, 'Base')
  const projDir = join(docsDir, 'Essays')
  mkdirSync(baseDir, { recursive: true })
  mkdirSync(projDir, { recursive: true })

  seedProfile({
    appearance: { color: 'mono', mode: 'dark', icon: 'pilcrow', migrationToastShown: true },
    // The v1.6.0–v1.6.2 clobber state: the slot holds the project's bookmark
    // and the base root's own bookmark is gone (unrecoverable).
    defaultSaveDirectory: baseDir,
    masDirectoryBookmark: PROJECT_BOOKMARK,
    activeProjectId: PROJECT_ID,
    projects: [
      {
        id: PROJECT_ID,
        name: 'Essays',
        path: projDir,
        bookmark: PROJECT_BOOKMARK,
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
  })
  await launch()

  // loadSettings detects the poisoned slot, clears it plus the inaccessible
  // base-root path, and persists the heal (JSON.stringify drops undefined).
  await expect
    .poll(() => 'masDirectoryBookmark' in readSettings(), { timeout: 10_000 })
    .toBe(false)

  const settings = readSettings()
  expect(settings.defaultSaveDirectory).toBeUndefined()
  // The project itself is untouched — only the legacy slot is healed.
  const projects = settings.projects as Array<{ bookmark?: string }>
  expect(projects[0].bookmark).toBe(PROJECT_BOOKMARK)
})
