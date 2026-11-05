/**
 * First-run onboarding: one multi-step modal (#1188).
 *
 * A fresh profile (no settings.json) shows one alert dialog over the empty
 * state and nothing after it. These cases drive the real modal through the
 * paths the design fixes: the explicit AI choice, the skippable steps, the
 * App Store build, Escape, and the re-entry of an existing user whose consent
 * version is stale. Each case launches its own app on its own profile.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, waitForAppReady, seedSettings } from './helpers'

let app: ElectronApplication | undefined
let page: Page
let userDataDir: string
let docsDir: string

const modal = () => page.getByTestId('onboarding')
const progress = () => page.getByTestId('onboarding-progress')
const primary = () => page.getByTestId('onboarding-primary')
const secondary = () => page.getByTestId('onboarding-secondary')
const back = () => page.getByTestId('onboarding-back')
const dialogs = () => page.locator('[role="alertdialog"]')

async function launch(env: Record<string, string> = {}): Promise<void> {
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1188-'))
  docsDir = mkdtempSync(join(tmpdir(), 'prose-1188-docs-'))
  const result = await launchApp({
    env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DOCS_DIR: docsDir, PROSE_DEBUG_PORT: '9229', ...env }
  })
  app = result.app
  page = result.page
  await waitForAppReady(page)
}

function readSettings(): Record<string, any> | null {
  const file = join(userDataDir, 'settings.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

test.afterEach(async () => {
  await app?.close()
  app = undefined
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(docsDir, { recursive: true, force: true })
})

test.describe('Electron — first-run onboarding (#1188)', () => {
  test('direct build, AI on: one modal, explicit choice, skippable steps, one write at Done', async () => {
    test.setTimeout(90_000)
    await launch()
    await expect(modal()).toBeVisible()
    await expect(dialogs()).toHaveCount(1)
    await expect(progress()).toHaveText(/^1 \/ 6 · Welcome$/i)
    await expect(back()).toHaveCount(0)

    await primary().click() // Get started
    await expect(progress()).toHaveText(/^2 \/ 6 · AI and privacy$/i)
    await expect(primary()).toBeDisabled()
    // Escape is inert before the choice.
    await page.keyboard.press('Escape')
    await expect(progress()).toHaveText(/^2 \/ 6 · AI and privacy$/i)
    await expect(modal()).toBeVisible()
    // Crash reports start unchecked.
    await expect(page.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('radio', { name: 'Use AI' }).click()
    await expect(page.getByRole('radio', { name: 'Use AI' })).toHaveAttribute('aria-checked', 'true')
    await expect(primary()).toBeEnabled()

    await primary().click()
    await expect(progress()).toHaveText(/^3 \/ 6 · API key$/i)
    await expect(primary()).toBeDisabled()
    await page.getByLabel('API key').fill('nope')
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(modal()).toContainText('should start with')
    await expect(primary()).toBeDisabled()
    await secondary().click() // Skip for now

    await expect(progress()).toHaveText(/^4 \/ 6 · Claude$/i)
    await primary().click() // Skip for now, or Continue when the MCP server is already installed here
    await expect(progress()).toHaveText(/^5 \/ 6 · Default editor$/i)
    await secondary().click() // Remind me later

    await expect(progress()).toHaveText(/^6 \/ 6 · Done$/i)
    const summary = page.getByTestId('onboarding-summary')
    await expect(summary).toContainText('On · add a key in Settings')
    await expect(summary).toContainText('Ask again next launch')
    await expect(summary.getByText('Crash reports').locator('..')).toContainText('Off')

    await primary().click() // New document
    await expect(modal()).toHaveCount(0)
    await expect(page.locator('.ProseMirror')).toBeVisible()
    await expect
      .poll(() => readSettings()?.aiConsent?.consented, { timeout: 10_000 })
      .toBe(true)
    const settings = readSettings()!
    expect(settings.aiConsent.version).toBeGreaterThanOrEqual(1)
    expect(settings.errorTracking?.enabled).toBe(false)
    expect(settings.fileAssociation?.hasBeenPrompted).toBeFalsy()
    // Nothing stacks behind it.
    await page.waitForTimeout(2_500)
    await expect(dialogs()).toHaveCount(0)
  })

  test('AI off: five steps, Escape skips to Done, Back works from Done, Escape finishes', async () => {
    test.setTimeout(90_000)
    await launch()
    await primary().click()
    await page.getByRole('radio', { name: 'Write without AI' }).click()
    await expect(progress()).toHaveText(/^2 \/ 5 · AI and privacy$/i)
    await page.keyboard.press('Escape')
    await expect(progress()).toHaveText(/^5 \/ 5 · Done$/i)
    await back().click()
    await expect(progress()).toHaveText(/^4 \/ 5 · Default editor$/i)
    await page.keyboard.press('Escape')
    await expect(progress()).toHaveText(/^5 \/ 5 · Done$/i)
    await page.keyboard.press('Escape')
    await expect(modal()).toHaveCount(0)
    await expect
      .poll(() => readSettings()?.aiConsent?.consented, { timeout: 10_000 })
      .toBe(false)
    await page.waitForTimeout(2_500)
    await expect(dialogs()).toHaveCount(0)
  })

  // The App Store build is stamped at build time (`build:env`, the preload's
  // `MAS_BUILD` define), so its four-step sequence is pinned by the vitest in
  // `steps.test.ts` and checked by hand on a MAS build; a runtime env cannot
  // switch it here.

  test('an existing user with a stale consent version re-enters at the AI step', async () => {
    test.setTimeout(90_000)
    userDataDir = mkdtempSync(join(tmpdir(), 'prose-1188-stale-'))
    seedSettings(userDataDir, {
      aiConsent: { consented: true, consentedAt: '2026-01-01T00:00:00.000Z', version: 0 }
    })
    docsDir = mkdtempSync(join(tmpdir(), 'prose-1188-docs-'))
    const result = await launchApp({
      env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DOCS_DIR: docsDir, PROSE_DEBUG_PORT: '9229' }
    })
    app = result.app
    page = result.page
    await waitForAppReady(page)
    await expect(modal()).toBeVisible()
    await expect(progress()).toHaveText(/^2 \/ 6 · AI and privacy$/i)
    await expect(primary()).toBeDisabled()
    await back().click()
    await expect(progress()).toHaveText(/^1 \/ 6 · Welcome$/i)
  })
})
