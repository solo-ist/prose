/**
 * Electron Projects navigation tests — regression coverage for the v1.6.x
 * base-root clobber: addProjectFromPicker used to set defaultSaveDirectory
 * (the stable root that back-navigation returns to) to the new project's
 * path, trapping the explorer inside that project (TestFlight v1.6.1 report).
 *
 * Launches with PROSE_USER_DATA_DIR pointing at a temp profile so the crafted
 * settings.json (and anything the app writes back) never touches the
 * developer's real profile.
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
let qaProjectDir: string

const PROJECT_NAME = 'qa-back-nav-project'

test.beforeAll(async () => {
  test.setTimeout(60_000)

  // Isolated profile + project fixture
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-profile-'))
  qaProjectDir = join(mkdtempSync(join(tmpdir(), 'prose-qa-fixtures-')), PROJECT_NAME)
  mkdirSync(qaProjectDir)
  writeFileSync(join(qaProjectDir, 'project-doc.md'), '# QA project doc\n')

  // Seed the exact on-disk state the clobber bug produced: a project whose
  // path is ALSO the defaultSaveDirectory (base root).
  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', icon: 'default' },
        projects: [
          {
            id: 'qa-back-nav',
            name: PROJECT_NAME,
            path: qaProjectDir,
            createdAt: '2026-06-04T00:00:00.000Z',
            lastOpenedAt: '2026-06-04T00:00:00.000Z',
          },
        ],
        activeProjectId: 'qa-back-nav',
        defaultSaveDirectory: qaProjectDir,
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
  rmSync(join(qaProjectDir, '..'), { recursive: true, force: true })
})

test.describe('Electron — Projects navigation', () => {
  test('boot heals a base root clobbered to a project path', async () => {
    // settingsStore.loadSettings clears defaultSaveDirectory when it equals a
    // project path and persists the healed shape back to disk.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const s = await (window as any).api.loadSettings()
            return s.defaultSaveDirectory ?? null
          }),
        { timeout: 10_000 },
      )
      .toBeNull()

    // The heal must only clear the base root — the project itself survives.
    const projects = await page.evaluate(async () => {
      const s = await (window as any).api.loadSettings()
      return (s.projects ?? []).map((p: { id: string }) => p.id)
    })
    expect(projects).toContain('qa-back-nav')
  })

  test('back button returns from an open project to the Projects index', async () => {
    await ensureFileListOpen(page)
    const panel = page.locator(selectors.fileListPanel)

    // Open the Projects view and enter the project
    await page.click('[aria-label="Projects"]')
    await panel.getByText(PROJECT_NAME).first().click()

    // Inside the project: back chevron + project contents visible
    const backButton = page.locator('[aria-label="Back to projects"]')
    await expect(backButton).toBeVisible({ timeout: 5_000 })
    // The file tree strips markdown extensions for display
    await expect(panel.getByText('project-doc')).toBeVisible({ timeout: 5_000 })

    // Back must land on the Projects index (pre-fix: resolved straight back
    // into the project because the base root pointed at it)
    await backButton.click()
    await expect(backButton).not.toBeVisible({ timeout: 5_000 })
    await expect(panel.getByText(PROJECT_NAME)).toBeVisible({ timeout: 5_000 })
  })

  test('Files toggle exits the project instead of re-rendering its contents', async () => {
    const panel = page.locator(selectors.fileListPanel)

    // Re-enter the project
    await panel.getByText(PROJECT_NAME).first().click()
    const backButton = page.locator('[aria-label="Back to projects"]')
    await expect(backButton).toBeVisible({ timeout: 5_000 })

    // The Files toggle calls exitToRoot. With no base root configured (the
    // heal cleared it), the folder view must fall back to the folder-picker
    // empty state — not keep showing the project's files.
    await page.click(selectors.filesButton)
    await expect(backButton).not.toBeVisible({ timeout: 5_000 })
    await expect(panel.getByText('Choose a folder to browse your documents.')).toBeVisible({
      timeout: 5_000,
    })
    await expect(panel.getByText('project-doc')).not.toBeVisible()
  })
})
