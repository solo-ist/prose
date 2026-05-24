#!/usr/bin/env node
// build-icons.mjs — Headless icon renderer + icns bundler
//
// Renders each PROSE_ICONS entry at 7 sizes (16/32/64/128/256/512/1024) by
// loading the icon components into a Playwright Chromium page, then bundles
// each set into a .icns via iconutil (macOS built-in).
//
// Output layout:
//   resources/icons/{id}/icon-{size}.png   (77 PNGs total)
//   resources/icons/{id}/icon.icns         (11 icns files, macOS only)
//
// Usage:
//   node scripts/build-icons.mjs           (from project root)
//   npm run icons

import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const ICONS_DIR = join(ROOT, 'resources', 'icons')

const SIZES = [16, 32, 64, 128, 256, 512, 1024]

// All 11 icon IDs — must match PROSE_ICONS in prose-icons.tsx
const ICON_IDS = [
  'pilcrow',
  'refined-p',
  'fraunces-p',
  'p-ist',
  'asterisk',
  'hash',
  'em-dash',
  'caret',
  'period',
  'prompt',
  'legacy',
]

// Load the legacy icon as base64 so it can be inlined into the HTML page
const legacyIconPath = join(ROOT, 'src', 'renderer', 'assets', 'icon-dark.png')
const legacyIconB64 = readFileSync(legacyIconPath).toString('base64')
const LEGACY_ICON_DATA_URL = `data:image/png;base64,${legacyIconB64}`

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
const CREAM_DIM = '#7d7770';
const GOLD = '#c8a45a';
const NEAR_BLACK = '#0a0a0a';
const PAPER = '#f4eee5';
const PAPER_DEEP = '#1a1814';
const SQUIRCLE = 0.2237;
const LEGACY_ICON_SRC = '${LEGACY_ICON_DATA_URL}';

function IconShell({ children, size = 320, bg = NEAR_BLACK, grain = true, light = false, ringColor, innerGlow }) {
  return h('div', {
    style: {
      position: 'relative',
      width: size,
      height: size,
      borderRadius: size * SQUIRCLE,
      background: bg,
      overflow: 'hidden',
      boxShadow: light
        ? '0 10px 36px rgba(0,0,0,0.14), inset 0 0 0 1px rgba(0,0,0,0.06)'
        : '0 14px 44px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.045)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      WebkitFontSmoothing: 'antialiased',
    }
  },
    innerGlow && h('div', { style: { position: 'absolute', inset: 0, background: innerGlow, pointerEvents: 'none' } }),
    grain && h('div', {
      style: {
        position: 'absolute',
        inset: 0,
        backgroundImage: NOISE_URL,
        backgroundSize: '200px 200px',
        opacity: light ? 0.09 : 0.16,
        mixBlendMode: light ? 'multiply' : 'screen',
        pointerEvents: 'none',
      }
    }),
    ringColor && h('div', {
      style: {
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        boxShadow: 'inset 0 0 0 1px ' + ringColor,
        pointerEvents: 'none',
      }
    }),
    h('div', { style: { position: 'relative', zIndex: 1, lineHeight: 1 } }, children)
  );
}

function IconRefinedP() {
  return h(IconShell, null,
    h('div', {
      style: {
        fontWeight: 200,
        fontSize: 240,
        letterSpacing: '-0.06em',
        color: CREAM,
        display: 'flex',
        alignItems: 'baseline',
        transform: 'translateY(8px)',
      }
    },
      h('span', null, 'P'),
      h('span', { style: { color: GOLD, marginLeft: -4 } }, '.')
    )
  );
}

function IconFrauncesP() {
  return h(IconShell, null,
    h('div', {
      style: {
        fontFamily: '"Fraunces", serif',
        fontStyle: 'italic',
        fontWeight: 360,
        fontVariationSettings: '"opsz" 144, "SOFT" 30',
        fontSize: 320,
        color: CREAM,
        letterSpacing: '-0.02em',
        transform: 'translateY(8px) translateX(-6px)',
        position: 'relative',
      }
    },
      'P',
      h('span', {
        style: {
          fontFamily: '"IBM Plex Mono", monospace',
          fontStyle: 'normal',
          fontWeight: 300,
          color: GOLD,
          fontSize: 110,
          position: 'absolute',
          right: -28,
          bottom: 36,
        }
      }, '.')
    )
  );
}

function IconPIstLockup() {
  return h(IconShell, null,
    h('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 14,
        transform: 'translateX(-4px)',
      }
    },
      h('div', { style: { fontSize: 170, fontWeight: 200, color: CREAM, letterSpacing: '-0.06em' } },
        'p',
        h('span', { style: { color: GOLD } }, '.')
      ),
      h('div', {
        style: {
          fontSize: 22,
          fontWeight: 400,
          color: CREAM_DIM,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          paddingLeft: 6,
        }
      }, 'prose')
    )
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

function IconAsterisk() {
  return h(IconShell, null,
    h('div', {
      style: {
        position: 'relative',
        width: 240,
        height: 240,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }
    },
      h('div', { style: { fontWeight: 200, fontSize: 360, color: CREAM, lineHeight: 1, transform: 'translateY(46px)' } }, '*'),
      h('div', {
        style: {
          position: 'absolute',
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: GOLD,
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }
      })
    )
  );
}

function IconHash() {
  return h(IconShell, null,
    h('div', { style: { fontWeight: 200, fontSize: 260, color: CREAM, letterSpacing: '-0.04em', transform: 'translateY(2px)' } },
      h('span', null, '#'),
      h('span', { style: { color: GOLD, fontSize: 96 } }, '.')
    )
  );
}

function IconPeriod() {
  return h(IconShell, { innerGlow: 'radial-gradient(circle at 50% 58%, rgba(200,164,90,0.18), transparent 55%)' },
    h('div', { style: { width: 64, height: 64, borderRadius: 8, background: GOLD, boxShadow: '0 0 60px rgba(200,164,90,0.45)' } })
  );
}

function IconPrompt() {
  return h(IconShell, null,
    h('div', {
      style: {
        fontWeight: 300,
        fontSize: 150,
        color: CREAM,
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        transform: 'translateY(4px)',
      }
    },
      h('span', null, '>'),
      h('span', { style: { display: 'inline-block', width: 56, height: 14, background: GOLD, marginBottom: 4 } })
    )
  );
}

function IconEmDash() {
  return h(IconShell, null,
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 0, fontWeight: 200, fontSize: 240, color: CREAM, letterSpacing: '-0.06em' } },
      h('span', null, '\\u2014'),
      h('span', { style: { color: GOLD } }, '.')
    )
  );
}

function IconCaret() {
  return h(IconShell, null,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 18, transform: 'translateY(-2px)' } },
      h('div', { style: { fontWeight: 300, fontSize: 170, color: CREAM_DIM, letterSpacing: '-0.04em', lineHeight: 1 } }, 'a'),
      h('div', { style: { width: 18, height: 140, background: GOLD } })
    )
  );
}

function IconRefinedPLight() {
  return h(IconShell, { bg: PAPER, light: true, ringColor: 'rgba(0,0,0,0.06)' },
    h('div', {
      style: {
        fontWeight: 200,
        fontSize: 240,
        letterSpacing: '-0.06em',
        color: PAPER_DEEP,
        display: 'flex',
        alignItems: 'baseline',
        transform: 'translateY(8px)',
      }
    },
      h('span', null, 'P'),
      h('span', { style: { color: GOLD, marginLeft: -4 } }, '.')
    )
  );
}

function IconFrauncesPLight() {
  return h(IconShell, { bg: PAPER, light: true, ringColor: 'rgba(0,0,0,0.06)' },
    h('div', {
      style: {
        fontFamily: '"Fraunces", serif',
        fontStyle: 'italic',
        fontWeight: 360,
        fontVariationSettings: '"opsz" 144, "SOFT" 30',
        fontSize: 320,
        color: PAPER_DEEP,
        letterSpacing: '-0.02em',
        transform: 'translateY(8px) translateX(-6px)',
        position: 'relative',
      }
    },
      'P',
      h('span', {
        style: {
          fontFamily: '"IBM Plex Mono", monospace',
          fontStyle: 'normal',
          fontWeight: 400,
          color: GOLD,
          fontSize: 110,
          position: 'absolute',
          right: -28,
          bottom: 36,
        }
      }, '.')
    )
  );
}

function IconPilcrowLight() {
  return h(IconShell, { bg: PAPER, light: true, ringColor: 'rgba(0,0,0,0.06)' },
    h('div', {
      style: {
        fontFamily: '"Fraunces", serif',
        fontStyle: 'italic',
        fontWeight: 340,
        fontVariationSettings: '"opsz" 144',
        fontSize: 280,
        color: PAPER_DEEP,
        transform: 'translateY(6px)',
      }
    }, '\\u00B6')
  );
}

function IconLegacy() {
  return h(IconShell, { bg: '#000', grain: false },
    h('img', { src: LEGACY_ICON_SRC, alt: '', style: { width: 320, height: 320, borderRadius: 320 * SQUIRCLE } })
  );
}

const ICON_MAP = {
  'pilcrow': IconPilcrow,
  'refined-p': IconRefinedP,
  'fraunces-p': IconFrauncesP,
  'p-ist': IconPIstLockup,
  'asterisk': IconAsterisk,
  'hash': IconHash,
  'em-dash': IconEmDash,
  'caret': IconCaret,
  'period': IconPeriod,
  'prompt': IconPrompt,
  'legacy': IconLegacy,
};

// All 11 icons in one page, each wrapped so we can locate them by id
const root = document.getElementById('root');
ReactDOM.render(
  h(Fragment, null,
    ...Object.entries(ICON_MAP).map(([id, Component]) =>
      h('div', { id: 'icon-' + id, style: { display: 'inline-block', position: 'absolute', top: 0, left: 0 } },
        h(Component, null)
      )
    )
  ),
  root
);

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

    let totalPngs = 0
    const pngMaps = new Map() // id -> Map<size, Buffer>

    for (const id of ICON_IDS) {
      const pngMap = new Map()
      pngMaps.set(id, pngMap)

      for (const size of SIZES) {
        // Set viewport to exactly the icon size
        await page.setViewportSize({ width: size, height: size })

        // Locate the element by id
        const el = page.locator(`#icon-${id}`)

        // Scale the 320×320 shell to exactly `size` pixels by setting CSS transform
        await page.evaluate(({ id, size }) => {
          const scale = size / 320
          const el = document.getElementById('icon-' + id)
          if (el) {
            el.style.transform = `scale(${scale})`
            el.style.transformOrigin = 'top left'
            el.style.width = '320px'
            el.style.height = '320px'
          }
        }, { id, size })

        // Screenshot just this element at native size
        const screenshot = await el.screenshot({
          type: 'png',
          omitBackground: false,
        })

        const outPath = join(ICONS_DIR, id, `icon-${size}.png`)
        writeFileSync(outPath, screenshot)
        pngMap.set(size, screenshot)
        totalPngs++
        process.stdout.write(`  [${id}] ${size}px... `)
        console.log('ok')
      }
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
