/**
 * macOS 26 icon appearance variants (#812).
 *
 * The packaging half: `mac.icon` points at an Icon Composer `.icon` bundle,
 * which electron-builder 26.15.3 compiles with `actool` into an `Assets.car`,
 * setting `CFBundleIconName`, and still emits an `.icns` for pre-26 macOS.
 *
 * These are config-and-asset guards, not UI tests — the rendering is macOS's
 * job and is verified by eye in QA (System Settings → Appearance → Icon &
 * widget style). What is worth guarding here is the set of ways this silently
 * reverts to a flat icon: `mac.icon` drifting back to the `.icns`, the bundle
 * losing its layer, or the CI Xcode pin disappearing so a runner image bump
 * takes actool below 26 and the build fails with a confusing error.
 */

import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BUNDLE = join(ROOT, 'resources/icons/pilcrow/AppIcon.icon')

test.describe('macOS icon appearance variants (#812)', () => {
  test('mac.icon points at the Icon Composer bundle, not the .icns', () => {
    const config = yaml.load(
      readFileSync(join(ROOT, 'electron-builder.yml'), 'utf-8'),
    ) as { mac?: { icon?: string } }
    // Reverting this to the .icns is the silent failure: the build still
    // succeeds and every appearance mode just renders the flat Default icon.
    expect(config.mac?.icon).toBe('resources/icons/pilcrow/AppIcon.icon')
  })

  test('the bundle has a layered mark, which is what Tinted and Clear mask', () => {
    expect(existsSync(BUNDLE)).toBe(true)
    const manifest = JSON.parse(readFileSync(join(BUNDLE, 'icon.json'), 'utf-8')) as {
      groups?: Array<{ layers?: Array<{ 'image-name'?: string }> }>
      fill?: unknown
    }
    const layers = manifest.groups?.flatMap((g) => g.layers ?? []) ?? []
    expect(layers.length).toBeGreaterThan(0)
    // A foreground layer independent of the background is the whole mechanism:
    // Tinted and Clear render the foreground as a flat silhouette. Flatten the
    // art into the background and those modes lose the glyph entirely.
    expect(layers.some((l) => l['image-name'] === 'pilcrow.svg')).toBe(true)
    expect(existsSync(join(BUNDLE, 'Assets/pilcrow.svg'))).toBe(true)
  })

  test('CI pins an Xcode new enough for actool', () => {
    // electron-builder THROWS without actool >= 26 rather than falling back, so
    // inheriting a runner image default is a silent dependency on the image.
    const workflow = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf-8')
    expect(workflow).toContain('xcode-select')
    expect(workflow).toMatch(/actool/)
  })
})
