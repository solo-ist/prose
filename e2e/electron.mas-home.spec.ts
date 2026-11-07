/**
 * Images resolve against the user's real home on the App Store build (#1223).
 *
 * Under the App Sandbox `HOME` is the app's container, so `os.homedir()` is too. The
 * `local-file:` image handler confines reads to a home root (#918); rooted at
 * `homedir()`, it refused every image outside the container, so no image in a document
 * loaded on MAS. This spec stands a scratch folder in for the container by launching
 * with `HOME` pointed at it, and loads an image that lives under the real home.
 *
 * MAS is a build-time stamp, so this runs only against a MAS-flagged build and skips
 * otherwise (CI builds the direct app):
 *
 *   MAS_BUILD=1 npm run build
 *   PROSE_DEBUG_PORT=9229 npx playwright test e2e/electron.mas-home.spec.ts
 *   npm run build   # restore the direct build
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp, waitForAppReady, seedSettings } from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const preload = resolve(__dirname, '..', 'out', 'preload-cjs', 'index.cjs')
const MAS_FLAGGED = existsSync(preload) && /isMasBuild:\s*true/.test(readFileSync(preload, 'utf8'))

// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

let app: ElectronApplication | undefined
let page: Page
const scratch: string[] = []

/** Load `path` through the image protocol the editor uses: its width, or -1 on error. */
function loadImage(path: string): Promise<number> {
  return page.evaluate(
    (src) =>
      new Promise<number>((done) => {
        const img = new Image()
        img.onload = () => done(img.naturalWidth)
        img.onerror = () => done(-1)
        img.src = src
      }),
    `local-file://${encodeURI(path)}`,
  )
}

test.describe('Electron — MAS images under the real home (#1223)', () => {
  test.skip(!MAS_FLAGGED, 'needs a MAS-flagged build: MAS_BUILD=1 npm run build')

  test.afterEach(async () => {
    await app?.close()
    app = undefined
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  test('an image under the real home loads while HOME is the container; one outside it does not', async () => {
    test.setTimeout(60_000)
    const realHome = userInfo().homedir
    // Under the real home but not under the stand-in container (which lives in tmpdir).
    const cacheRoot = join(realHome, 'Library', 'Caches')
    mkdirSync(cacheRoot, { recursive: true })
    const imageDir = mkdtempSync(join(cacheRoot, 'prose-1223-e2e-'))
    const container = mkdtempSync(join(tmpdir(), 'prose-1223-container-'))
    const userDataDir = mkdtempSync(join(tmpdir(), 'prose-1223-profile-'))
    const outside = mkdtempSync(join(tmpdir(), 'prose-1223-outside-'))
    scratch.push(imageDir, container, userDataDir, outside)
    writeFileSync(join(imageDir, 'dot.png'), PNG)
    writeFileSync(join(outside, 'dot.png'), PNG)
    seedSettings(userDataDir)

    const launched = await launchApp({
      env: { HOME: container, PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9229' },
    })
    app = launched.app
    page = launched.page
    await waitForAppReady(page)
    expect(await page.evaluate(() => (window as any).api?.isMasBuild)).toBe(true)

    // The fix: rooted at the real home, the image loads.
    expect(await loadImage(join(imageDir, 'dot.png'))).toBe(1)
    // The confinement still holds: outside the real home is refused.
    expect(await loadImage(join(outside, 'dot.png'))).toBe(-1)
  })
})
