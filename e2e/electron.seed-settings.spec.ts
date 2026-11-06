/**
 * Spec profiles keep the first-run surfaces off (#1113).
 *
 * The post-update release notes are suppressed only while the AI consent
 * dialog is due. A spec that seeds `aiConsent` therefore runs under an
 * undismissed release-notes modal unless it also seeds `lastSeenVersion`,
 * which eleven specs did not. `seedSettings` in `e2e/helpers.ts` carries the
 * baseline; this source-level check keeps the gap closed: every Electron
 * spec that seeds consent goes through the helper or seeds the version itself.
 */

import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

test('every Electron spec that seeds aiConsent suppresses the release-notes modal', () => {
  const offenders: string[] = []
  for (const file of readdirSync(here)) {
    if (!/^electron\..*\.spec\.ts$/.test(file) || file === 'electron.seed-settings.spec.ts') continue
    const source = readFileSync(join(here, file), 'utf8')
    if (!/\baiConsent\b/.test(source)) continue
    if (/\bseedSettings\(/.test(source) || /\blastSeenVersion\b/.test(source)) continue
    offenders.push(file)
  }
  expect(offenders, 'specs seeding aiConsent without seedSettings() or lastSeenVersion').toEqual([])
})
