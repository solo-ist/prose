/**
 * Regression coverage for the Google Docs removal (#1057).
 *
 * Removing the integration left one piece of residue in our own state file:
 * the `google` block in settings.json, which stores the connected account's
 * email and profile-picture URL. `settings:load` now strips it. This matters
 * for two reasons — it is personal data belonging to a feature that no longer
 * exists, and `settings:load` spreads the parsed JSON, so without the strip the
 * key would be written back to disk on every subsequent save.
 *
 * Runs in an isolated PROSE_USER_DATA_DIR profile; the seeded account block is
 * fictional.
 *
 * Keep the seed to top-level keys plus `appearance`. `settings:load` merges with
 * `{ ...defaultSettings, ...parsed }` — a *shallow* spread — so seeding a partial
 * nested object (`editor: { fontSize: 18 }`) replaces the whole default and drops
 * its siblings (`fontFamily`, `bulletListMarker`), which stops the renderer from
 * mounting. That cost one CI run.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay } from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaFilesDir: string

function readSettingsFromDisk(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(qaUserDataDir, 'settings.json'), 'utf-8'))
}

test.beforeAll(async () => {
  test.setTimeout(90_000)

  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-google-residue-'))
  qaFilesDir = mkdtempSync(join(tmpdir(), 'prose-qa-google-residue-files-'))
  writeFileSync(join(qaFilesDir, 'notes.md'), '# Notes\n')

  // The on-disk shape a user who had connected Google Docs is left with.
  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', icon: 'pilcrow' },
        defaultSaveDirectory: qaFilesDir,
        google: {
          email: 'qa-fixture@example.com',
          picture: 'https://example.invalid/avatar.png',
          connectedAt: '2026-05-01T00:00:00.000Z',
          syncDirectory: '/tmp/prose-qa-google-docs',
          lastSyncedAt: '2026-05-02T00:00:00.000Z',
        },
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
  rmSync(qaFilesDir, { recursive: true, force: true })
})

test.describe('Electron — Google Docs removal residue (#1057)', () => {
  test('the stored google account block is stripped from disk on load', async () => {
    await expect
      .poll(() => Object.prototype.hasOwnProperty.call(readSettingsFromDisk(), 'google'), {
        timeout: 10_000,
      })
      .toBe(false)
  })

  test('the renderer never receives a google key', async () => {
    const hasGoogle = await page.evaluate(async () => {
      const s = await (window as any).api.loadSettings()
      return Object.prototype.hasOwnProperty.call(s ?? {}, 'google')
    })
    expect(hasGoogle).toBe(false)
  })

  test('unrelated settings survive the strip', async () => {
    // The strip rewrites the whole file, so prove it is a surgical delete and
    // not a reset to defaults.
    const onDisk = readSettingsFromDisk() as { appearance?: { mode?: string } }
    expect(onDisk.appearance?.mode).toBe('dark')
  })
})
