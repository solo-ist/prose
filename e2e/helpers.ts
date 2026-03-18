/**
 * Electron test helpers — re-exports shared helpers and adds Electron-specific launch.
 *
 * Smoke tests import from here; web tests import from './shared' directly.
 */

import { type ElectronApplication, type Page, _electron as electron } from '@playwright/test'
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
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
export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const projectRoot = resolve(__dirname, '..')

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
      args: [appInfo.main],
    })
  } else {
    app = await electron.launch({
      args: [appPath],
    })
  }

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return { app, page }
}
