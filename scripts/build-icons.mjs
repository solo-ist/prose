#!/usr/bin/env node
// build-icons.mjs — Headless icon renderer + icns bundler
//
// Renders the Prose icon at 7 sizes (16/32/64/128/256/512/1024) by loading
// the icon component into a Playwright Chromium page, then bundles the set
// into a .icns via iconutil (macOS built-in).
//
// Output layout:
//   resources/icons/pilcrow/icon-{size}.png   (7 PNGs)
//   resources/icons/pilcrow/icon.icns         (macOS only)
//
// Usage:
//   node scripts/build-icons.mjs           (from project root)
//   npm run icons

import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const ICONS_DIR = join(ROOT, 'resources', 'icons')

const SIZES = [16, 32, 64, 128, 256, 512, 1024]

// Must match PROSE_ICONS in prose-icons.tsx. Pilcrow is the only icon as of
// 1.9.0 (#1052) — the switcher and its six other variants were removed.
const ICON_IDS = ['pilcrow']

// ── HTML template ──────────────────────────────────────────────────────────────
// This is a self-contained HTML page that renders all icons.
// It uses inline React (UMD) so no bundling step is needed.
// Font loading: we load IBM Plex Mono from Google Fonts (network required)
// and Fraunces from Google Fonts. Both are standard web fonts.

function buildHtml() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: transparent; }
  .icon-wrapper { display: inline-block; }
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400&family=Fraunces:ital,opsz,wght,SOFT@1,144,300,0;1,144,340,0;1,144,360,30&display=swap" rel="stylesheet">
</head>
<body>
<div id="root"></div>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script>
const { createElement: h, Fragment } = React;

// Constants
const NOISE_URL = "url(\\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\\")";
const CREAM = '#e3dbd1';
const NEAR_BLACK = '#0a0a0a';
const SQUIRCLE = 0.2237;

function IconShell({ children, size = 320, bg = NEAR_BLACK, grain = true }) {
  return h('div', {
    style: {
      position: 'relative',
      width: size,
      height: size,
      borderRadius: size * SQUIRCLE,
      background: bg,
      overflow: 'hidden',
      boxShadow: '0 3px 10px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.06)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      WebkitFontSmoothing: 'antialiased',
    }
  },
    grain && h('div', {
      style: {
        position: 'absolute',
        inset: 0,
        backgroundImage: NOISE_URL,
        backgroundSize: '200px 200px',
        opacity: 0.16,
        mixBlendMode: 'screen',
        pointerEvents: 'none',
      }
    }),
    h('div', { style: { position: 'relative', zIndex: 1, lineHeight: 1 } }, children)
  );
}

function IconPilcrow() {
  return h(IconShell, null,
    h('div', {
      style: {
        fontFamily: '"Fraunces", serif',
        fontStyle: 'italic',
        fontWeight: 340,
        fontVariationSettings: '"opsz" 144',
        fontSize: 280,
        color: CREAM,
        transform: 'translateY(6px)',
      }
    }, '\\u00B6')
  );
}

const ICON_MAP = {
  'pilcrow': IconPilcrow,
};

// Render ONE icon at a time into a fixed transparent canvas. Rendering all 11
// stacked at the same position let the last one (legacy) leak into every
// screenshot — so we re-render per icon instead. The 320px shell sits centered
// in a 400px transparent canvas → ~10% macOS safe-area margin on every side.
const CANVAS = 400;
const root = document.getElementById('root');

window.__renderIcon = function (id) {
  const Component = ICON_MAP[id];
  ReactDOM.render(
    h('div', {
      id: 'icon-canvas',
      style: {
        width: CANVAS,
        height: CANVAS,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        transformOrigin: 'top left',
      }
    }, h(Component, null)),
    root
  );
};

window.__ICONS_READY__ = true;
</script>
</body>
</html>`
}

// ── iconutil helper ──────────────────────────────────────────────────────────
// macOS iconutil requires a specific iconset directory structure.
// https://developer.apple.com/library/archive/documentation/GraphicsImaging/Conceptual/OpenWithURLs/OpenWithURLs.html
const ICONUTIL_SIZES = [
  { size: 16,   scale: 1, name: 'icon_16x16.png' },
  { size: 32,   scale: 2, name: 'icon_16x16@2x.png' },
  { size: 32,   scale: 1, name: 'icon_32x32.png' },
  { size: 64,   scale: 2, name: 'icon_32x32@2x.png' },
  { size: 128,  scale: 1, name: 'icon_128x128.png' },
  { size: 256,  scale: 2, name: 'icon_128x128@2x.png' },
  { size: 256,  scale: 1, name: 'icon_256x256.png' },
  { size: 512,  scale: 2, name: 'icon_256x256@2x.png' },
  { size: 512,  scale: 1, name: 'icon_512x512.png' },
  { size: 1024, scale: 2, name: 'icon_512x512@2x.png' },
]

function buildIcns(iconId, pngMap) {
  // pngMap: Map<size, Buffer>
  const iconsetDir = mkdtempSync(join(tmpdir(), `prose-iconset-${iconId}-`)) + '.iconset'
  mkdirSync(iconsetDir)

  for (const { size, name } of ICONUTIL_SIZES) {
    const buf = pngMap.get(size)
    if (!buf) throw new Error(`Missing PNG for size ${size} (icon: ${iconId})`)
    writeFileSync(join(iconsetDir, name), buf)
  }

  const outIcns = join(ICONS_DIR, iconId, 'icon.icns')
  execSync(`iconutil -c icns -o "${outIcns}" "${iconsetDir}"`)
  // Clean up temp iconset
  rmSync(iconsetDir, { recursive: true, force: true })
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Building Prose icon assets...')
  console.log(`  Sizes: ${SIZES.join(', ')}`)
  console.log(`  Icons: ${ICON_IDS.join(', ')}`)
  console.log()

  // Ensure output directories exist
  for (const id of ICON_IDS) {
    mkdirSync(join(ICONS_DIR, id), { recursive: true })
  }

  const html = buildHtml()
  const tmpHtml = join(tmpdir(), 'prose-build-icons.html')
  writeFileSync(tmpHtml, html)

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-web-security', '--allow-file-access-from-files'],
  })

  try {
    const context = await browser.newContext({
      // 1:1 device pixel ratio — we control exact pixel sizes via viewport
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()

    // Load the HTML page (file:// so the data URL for the legacy icon works)
    await page.goto(`file://${tmpHtml}`)

    // Wait for React to render and fonts to load
    await page.waitForFunction(() => window.__ICONS_READY__ === true)
    // Give fonts extra time to load (Google Fonts)
    await page.waitForTimeout(2000)

    const CANVAS = 400 // must match window.__renderIcon's canvas size
    let totalPngs = 0
    const pngMaps = new Map() // id -> Map<size, Buffer>

    for (const id of ICON_IDS) {
      const pngMap = new Map()
      pngMaps.set(id, pngMap)

      // Render ONLY this icon, so no other icon can leak into its screenshot.
      await page.evaluate((id) => window.__renderIcon(id), id)
      await page.waitForTimeout(200) // let React render + layout settle

      for (const size of SIZES) {
        await page.setViewportSize({ width: size, height: size })

        // Scale the 400px transparent canvas down/up to exactly `size` pixels.
        await page.evaluate(({ size, CANVAS }) => {
          const el = document.getElementById('icon-canvas')
          if (el) el.style.transform = `scale(${size / CANVAS})`
        }, { size, CANVAS })

        // Capture with a transparent backdrop so the safe-area margin and the
        // squircle's rounded corners stay transparent.
        const el = page.locator('#icon-canvas')
        const screenshot = await el.screenshot({ type: 'png', omitBackground: true })

        const outPath = join(ICONS_DIR, id, `icon-${size}.png`)
        writeFileSync(outPath, screenshot)
        pngMap.set(size, screenshot)
        totalPngs++
      }
      console.log(`  [${id}] 7 sizes ... ok`)
    }

    console.log()
    console.log(`Generated ${totalPngs} PNGs.`)

    // Build .icns files (macOS only — iconutil is macOS built-in)
    if (process.platform === 'darwin') {
      console.log()
      console.log('Building .icns files...')
      for (const id of ICON_IDS) {
        buildIcns(id, pngMaps.get(id))
        console.log(`  [${id}] icon.icns ... ok`)
      }
      console.log(`\nBuilt ${ICON_IDS.length} .icns files.`)
    } else {
      console.log('\nSkipping .icns (not macOS).')
    }
  } finally {
    await browser.close()
  }

  console.log('\nDone. Output: resources/icons/{id}/')
}

main().catch((err) => {
  console.error('build-icons failed:', err)
  process.exit(1)
})
