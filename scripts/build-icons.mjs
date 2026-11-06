#!/usr/bin/env node
// build-icons.mjs — resample the delivered 1024 master into the shipped icon set
//
// Reads  resources/icons/pilcrow/icon-1024.png  (the delivered vector art,
// rendered once at 1024 and committed as the master) and produces:
//
//   resources/icons/pilcrow/icon-{16,32,64,128,256,512}.png
//   resources/icons/pilcrow/icon.icns            (macOS only)
//
// It used to render the mark by loading a React component into a Playwright
// Chromium page, with the glyph set in Fraunces pulled from Google Fonts. That
// made the app's identity depend on a browser install and a network fetch at
// build time — and `npm run icons` could not run at all on a machine where the
// Playwright browser install had failed. Now it is `sips` + `iconutil`, both
// built into macOS (#1063).
//
// Usage:
//   node scripts/build-icons.mjs           (from project root)
//   npm run icons

import { existsSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const ICON_DIR = join(ROOT, 'resources', 'icons', 'pilcrow')
const MASTER = join(ICON_DIR, 'icon-1024.png')

/** Sizes the app and the .icns need. 1024 is the master and is not resampled. */
const SIZES = [16, 32, 64, 128, 256, 512]

/** `iconutil` requires exactly these names; @2x entries are the 2× renders. */
const ICNS_SET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

function resample(src, dest, size) {
  execFileSync('sips', ['-z', String(size), String(size), src, '--out', dest], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
}

function main() {
  if (!existsSync(MASTER)) {
    console.error(`Missing master art: ${MASTER}`)
    process.exit(1)
  }
  if (process.platform !== 'darwin') {
    console.error('build-icons needs macOS (sips + iconutil).')
    process.exit(1)
  }

  for (const size of SIZES) {
    const dest = join(ICON_DIR, `icon-${size}.png`)
    resample(MASTER, dest, size)
    console.log(`  icon-${size}.png`)
  }

  // iconutil only accepts a directory literally named *.iconset.
  const work = mkdtempSync(join(tmpdir(), 'prose-icons-'))
  const iconset = join(work, 'icon.iconset')
  execFileSync('mkdir', ['-p', iconset])
  try {
    for (const [name, size] of ICNS_SET) {
      const dest = join(iconset, name)
      if (size === 1024) copyFileSync(MASTER, dest)
      else resample(MASTER, dest, size)
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(ICON_DIR, 'icon.icns')])
    console.log('  icon.icns')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }

  console.log(`\nWrote ${SIZES.length + 1} PNGs + icon.icns to ${ICON_DIR}`)
}

main()
