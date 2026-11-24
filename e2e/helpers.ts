/**
 * Electron test helpers — re-exports shared helpers and adds Electron-specific launch.
 *
 * Smoke tests import from here; web tests import from './shared' directly.
 */

import { type ElectronApplication, type Page, _electron as electron } from '@playwright/test'
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Re-export all shared helpers so existing imports remain valid
export * from './shared'

// ---------------------------------------------------------------------------
// Electron launch helper
// ---------------------------------------------------------------------------

/**
 * Launch the Electron app for testing.
 *
 * In CI, launches from the built output (requires `npm run build` first).
 * Locally, can optionally launch from source via electron-vite dev.
 */
/**
 * Write a spec profile's `settings.json` with the baseline every Electron spec
 * needs and the spec's own keys on top (#1113). The baseline keeps the
 * first-run surfaces off: the default-handler prompt (`fileAssociation`), the
 * AI consent dialog (`aiConsent`, override it to test consent itself) and the
 * post-update release notes (`lastSeenVersion` = this build's version; the
 * modal is suppressed only while consent is due, so a spec that seeds consent
 * without this ran under an undismissed modal). A key in `overrides` replaces
 * the baseline key wholesale.
 */
/**
 * Draw the macOS window buttons into the page, for the marketing captures.
 * `page.screenshot` captures the web contents only, so the native buttons are
 * missing and the toolbar's 88px inset for them reads as a stray gap. The
 * position matches `trafficLightPosition` in `src/main/index.ts` (16, 16);
 * the buttons are the standard 12px circles on a 20px pitch.
 */
export async function drawWindowButtons(page: Page): Promise<void> {
  await page.evaluate(() => {
    const id = 'shot-window-buttons'
    document.getElementById(id)?.remove()
    const row = document.createElement('div')
    row.id = id
    row.style.cssText = 'position:fixed;left:16px;top:16px;display:flex;gap:8px;z-index:2147483647;pointer-events:none'
    for (const color of ['#FF5F57', '#FEBC2E', '#28C840']) {
      const dot = document.createElement('div')
      dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color};box-shadow:inset 0 0 0 0.5px rgba(0,0,0,0.18)`
      row.appendChild(dot)
    }
    document.body.appendChild(row)
  })
}

export function seedSettings(userDataDir: string, overrides: Record<string, unknown> = {}): void {
  const projectRoot = resolve(__dirname, '..')
  const appVersion = (JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf-8')) as { version: string }).version
  mkdirSync(userDataDir, { recursive: true })
  const settings = {
    fileAssociation: { hasBeenPrompted: true },
    aiConsent: { consented: true, consentedAt: '2026-01-01T00:00:00.000Z', version: 1 },
    lastSeenVersion: appVersion,
    ...overrides,
  }
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify(settings, null, 2))
}

export async function launchApp(
  options?: { env?: Record<string, string>; args?: string[] },
): Promise<{ app: ElectronApplication; page: Page }> {
  const projectRoot = resolve(__dirname, '..')
  // Merge env overrides over the inherited environment — Playwright's `env`
  // replaces the child process environment wholesale, so the spread keeps
  // PATH etc. intact. Used by tests that need an isolated HOME (userData).
  //
  // PROSE_HEADLESS defaults ON (#1078): otherwise a suite run opens ~40 windows,
  // each stealing focus, which makes the machine unusable while it runs. The
  // window is still created and still renders — it is just never shown — so
  // Playwright drives it over CDP exactly as before. Run with PROSE_HEADLESS=0
  // to watch the app, which is what you want when debugging a failure.
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PROSE_HEADLESS: process.env.PROSE_HEADLESS ?? '1',
    ...(options?.env ?? {}),
  }
  // Extra Chromium/Electron switches (e.g. --password-store=basic so
  // safeStorage works on keyring-less Linux CI). Position-independent:
  // Chromium parses switches from anywhere in argv.
  const extraArgs = options?.args ?? []

  // Try to find a packaged build first (electron-builder output)
  let appPath: string
  try {
    appPath = findLatestBuild(projectRoot)
    console.log(`[e2e] Using packaged build: ${appPath}`)
  } catch {
    // No packaged build — launch from source using electron-vite output
    appPath = resolve(projectRoot, 'out/main/index.js')
    if (!existsSync(appPath)) {
      throw new Error(
        `Build output not found at ${appPath}. Run "npm run build" before running tests.`,
      )
    }
    console.log(`[e2e] Using dev build: ${appPath}`)
  }

  // Determine if we're launching a packaged app or from source
  const isPackaged = !appPath.endsWith('.js')

  let app: ElectronApplication

  if (isPackaged) {
    const appInfo = parseElectronApp(appPath)
    app = await electron.launch({
      executablePath: appInfo.executable,
      args: [appInfo.main, ...extraArgs],
      ...(env ? { env } : {}),
    })
  } else {
    app = await electron.launch({
      args: [appPath, ...extraArgs],
      ...(env ? { env } : {}),
    })
  }

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return { app, page }
}

/**
 * Close an open Radix Select with Escape, leaving the dialog behind it open.
 *
 * Escape goes to the topmost dismissable layer. The Select only becomes that
 * layer once its listbox holds focus, a moment after its options are in the
 * DOM. An Escape pressed in that gap reaches the dialog underneath and closes
 * it (seen with @radix-ui/react-select 2.4 and react-dialog 1.3; no person
 * presses a key that fast). So: wait for focus to be in the listbox, press,
 * then wait for the listbox to go.
 */
export async function closeSelect(page: Page): Promise<void> {
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="listbox"]'))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[role="listbox"]'))
}
