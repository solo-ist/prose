/**
 * Post-update release-notes modal (#1058).
 *
 * The modal is driven by a stored-version compare (`settings.lastSeenVersion` vs
 * `APP_VERSION`), not by an updater event — the updater is disabled on MAS and in
 * dev, and `updater:update-available` fires before restart. These tests pin the
 * three states that compare produces, because each one has a way to be wrong that
 * a build would not catch:
 *
 *  - an *upgraded* profile must see the modal exactly once, and the notes must be
 *    the bundled ones for this version (not a stale file, not an empty modal);
 *  - dismissing must persist `lastSeenVersion` to disk, or the modal returns on
 *    every launch forever;
 *  - a *fresh install* must NOT see it — it is mid-onboarding with nothing to
 *    catch up on — and must still record the version, so the next real update is
 *    the first one that shows notes.
 *
 * Runs in isolated PROSE_USER_DATA_DIR profiles. Seeds stay at top-level keys plus
 * `appearance`: `settings:load` merges with a *shallow* spread, so a partial nested
 * object replaces the whole default and drops its siblings.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp, waitForAppReady } from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const APP_VERSION: string = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf-8'),
).version
const NOTES_PATH = join(projectRoot, 'resources', 'release-notes', `${APP_VERSION}.md`)

const DIALOG = '[data-testid="release-notes-dialog"]'
const DISMISS = '[data-testid="release-notes-dismiss"]'

/** A profile shaped like an existing user: consent already given, on an older version. */
function seedUpgradedProfile(dir: string, filesDir: string, lastSeenVersion: string | null) {
  const settings: Record<string, unknown> = {
    appearance: { mode: 'dark', icon: 'pilcrow' },
    defaultSaveDirectory: filesDir,
    aiConsent: { consented: true, consentedAt: '2026-01-01T00:00:00.000Z', version: 1 },
  }
  if (lastSeenVersion !== null) settings.lastSeenVersion = lastSeenVersion
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2))
}

function readSettings(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'))
}

function makeProfile(tag: string): { userDataDir: string; filesDir: string } {
  const userDataDir = mkdtempSync(join(tmpdir(), `prose-qa-relnotes-${tag}-`))
  const filesDir = mkdtempSync(join(tmpdir(), `prose-qa-relnotes-${tag}-files-`))
  writeFileSync(join(filesDir, 'notes.md'), '# Notes\n')
  return { userDataDir, filesDir }
}

/**
 * Deliberately does NOT call `dismissOnboarding` / `dismissOverlay`.
 *
 * Both end by pressing Escape at any `[data-state="open"].fixed.inset-0` — which is
 * exactly what this dialog's own overlay is. The dialog opens ~2.5s in, after an
 * async IPC read, landing inside the window those helpers sweep, so they dismiss the
 * subject of the test. Verified with a probe: the dialog was visible *and*
 * `lastSeenVersion` already written at the first poll.
 */
async function boot(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir } })
  await waitForAppReady(launched.page)
  return launched
}

test.describe('Electron — post-update release notes (#1058)', () => {
  test('this version ships a bundled notes file', () => {
    // Self-heal first: the no-notes test below hides this file and restores it in a
    // `finally`, but a SIGKILL mid-test would skip that and leave every later run
    // failing here for the wrong reason.
    const stray = `${NOTES_PATH}.hidden-by-test`
    if (existsSync(stray) && !existsSync(NOTES_PATH)) renameSync(stray, NOTES_PATH)

    // The modal is silent without it, so a missing file would make every other
    // assertion here vacuous. Fail loudly instead.
    expect(
      existsSync(NOTES_PATH),
      `expected release notes at resources/release-notes/${APP_VERSION}.md`,
    ).toBe(true)
    expect(readFileSync(NOTES_PATH, 'utf-8').trim().length).toBeGreaterThan(0)
  })

  test('an upgraded profile sees the notes once, then never again', async () => {
    test.setTimeout(120_000)
    const { userDataDir, filesDir } = makeProfile('upgrade')
    seedUpgradedProfile(userDataDir, filesDir, '1.8.0')

    let launched = await boot(userDataDir)
    try {
      const dialog = launched.page.locator(DIALOG)
      await expect(dialog).toBeVisible({ timeout: 15_000 })

      // The notes are the bundled ones for THIS version, rendered as real
      // elements. Assert on a heading from the file rather than the whole body,
      // so editing the prose does not break the test.
      await expect(dialog).toContainText(`What's new in Prose ${APP_VERSION}`)

      // Markdown must render as markup, never as literal source. This is the
      // invariant that the hand-rolled renderer exists to hold.
      await expect(dialog).not.toContainText('**')
      await expect(dialog).not.toContainText('##')

      await launched.page.click(DISMISS)
      await expect(dialog).toBeHidden()

      // Persisted, not just in memory — otherwise the modal returns every launch.
      await expect
        .poll(() => readSettings(userDataDir).lastSeenVersion, { timeout: 10_000 })
        .toBe(APP_VERSION)
    } finally {
      await launched.app?.close()
    }

    // Relaunch the same profile: the compare now matches, so no modal.
    launched = await boot(userDataDir)
    try {
      await launched.page.waitForTimeout(3_000)
      await expect(launched.page.locator(DIALOG)).toHaveCount(0)
    } finally {
      await launched.app?.close()
      rmSync(userDataDir, { recursive: true, force: true })
      rmSync(filesDir, { recursive: true, force: true })
    }
  })

  test('a fresh install is not shown the notes, but does record the version', async () => {
    test.setTimeout(90_000)
    const { userDataDir, filesDir } = makeProfile('fresh')
    // No aiConsent: the consent dialog is due, which is how a fresh install is
    // identified. The notes modal must defer to onboarding.
    writeFileSync(
      join(userDataDir, 'settings.json'),
      JSON.stringify(
        { appearance: { mode: 'dark', icon: 'pilcrow' }, defaultSaveDirectory: filesDir },
        null,
        2,
      ),
    )

    const launched = await boot(userDataDir)
    try {
      await launched.page.waitForTimeout(3_000)
      await expect(launched.page.locator(DIALOG)).toHaveCount(0)

      // Recorded silently, so the NEXT update is the first that shows notes.
      await expect
        .poll(() => readSettings(userDataDir).lastSeenVersion, { timeout: 10_000 })
        .toBe(APP_VERSION)
    } finally {
      await launched.app?.close()
      rmSync(userDataDir, { recursive: true, force: true })
      rmSync(filesDir, { recursive: true, force: true })
    }
  })

  test('a build with no notes for its version stays silent and records the version', async () => {
    test.setTimeout(90_000)
    const { userDataDir, filesDir } = makeProfile('nonotes')
    // The compare fires — consent given, older stored version — but there are no
    // notes for this build. That is the local-build / hotfix-tag path, and it must
    // stay silent rather than open an empty modal, while still recording the
    // version so the next real update is not swallowed.
    seedUpgradedProfile(userDataDir, filesDir, '1.8.0')

    // Hide the bundled notes so the app genuinely finds none for its own version.
    // The dev build reads them from the repo, and the suite runs serially
    // (workers: 1, fullyParallel: false), so no other test can observe this.
    const hidden = `${NOTES_PATH}.hidden-by-test`
    renameSync(NOTES_PATH, hidden)

    let launched: { app: ElectronApplication; page: Page } | undefined
    try {
      launched = await boot(userDataDir)

      // The IPC contract: a version with no file reports null rather than throwing.
      const missing = await launched.page.evaluate(
        async () =>
          await (
            window as never as { api: { getReleaseNotes: (v: string) => Promise<unknown> } }
          ).api.getReleaseNotes('99.99.99'),
      )
      expect(missing).toBeNull()

      // The integration path: no modal, despite the version compare firing.
      await launched.page.waitForTimeout(3_000)
      await expect(launched.page.locator(DIALOG)).toHaveCount(0)

      // ...and the version is still recorded, so the next update shows its notes.
      await expect
        .poll(() => readSettings(userDataDir).lastSeenVersion, { timeout: 10_000 })
        .toBe(APP_VERSION)
    } finally {
      await launched?.app?.close()
      if (existsSync(hidden)) renameSync(hidden, NOTES_PATH)
      rmSync(userDataDir, { recursive: true, force: true })
      rmSync(filesDir, { recursive: true, force: true })
    }
  })
})
