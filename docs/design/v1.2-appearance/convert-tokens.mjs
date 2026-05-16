#!/usr/bin/env node
// Hex/rgba → HSL converter for issue #499 v1.2 Appearance.
//
// Reads the 14 `--t-*` source values per theme/mode from themes.css and
// emits the translated shadcn HSL token table to themes-converted.md.
// Pure stdlib — no dependencies. Idempotent: re-running produces byte-identical output.
//
// Usage:
//   node docs/design/v1.2-appearance/convert-tokens.mjs
//
// Output goes to docs/design/v1.2-appearance/themes-converted.md; the exact
// HSL triplets in that file are what gets pasted into src/renderer/index.css.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'themes-converted.md')

// ── Source values (mirrored from themes.css) ───────────────────────────────
// Each theme/mode declares the 14 --t-* tokens. Values copied verbatim from
// docs/design/v1.2-appearance/themes.css so this script + that file are the
// single source of truth — re-running picks up any future edits there.

const SOURCE = {
  prose: {
    light: {
      'bg':           '#f4eee5',
      'bg-2':         '#fbf6ec',
      'bg-3':         '#ebe3d4',
      'text':         '#1a1814',
      'text-2':       '#5a554d',
      'text-3':       '#8e8980',
      'border':       '#d8cdb8',
      'border-2':     '#c4b89e',
      'accent':       '#9a7a3e',
      'accent-soft':  'rgba(154,122,62,0.10)',
      'accent-fg':    '#f4eee5',
      'titlebar':     '#efe7d8',
      'disabled':     '#c4b89e',
    },
    dark: {
      'bg':           '#0a0a0a',
      'bg-2':         '#16140f',
      'bg-3':         '#0d0c0a',
      'text':         '#e3dbd1',
      'text-2':       '#7d7770',
      'text-3':       '#4a4641',
      'border':       '#1d1d1d',
      'border-2':     '#2c2a26',
      'accent':       '#c8a45a',
      'accent-soft':  'rgba(200,164,90,0.10)',
      'accent-fg':    '#0a0a0a',
      'titlebar':     '#1c1a17',
      'disabled':     '#2c2a26',
    },
  },
  termy: {
    light: {
      'bg':           '#eaf1de',
      'bg-2':         '#f1f6e7',
      'bg-3':         '#dce6c9',
      'text':         '#0e2e10',
      'text-2':       '#2d5530',
      'text-3':       '#6b8b6e',
      'border':       '#b8cba2',
      'border-2':     '#9ab584',
      'accent':       '#1d6b34',
      'accent-soft':  'rgba(29,107,52,0.10)',
      'accent-fg':    '#eaf1de',
      'titlebar':     '#dfe7cc',
      'disabled':     '#9ab584',
    },
    dark: {
      'bg':           '#020806',
      'bg-2':         '#061008',
      'bg-3':         '#010604',
      'text':         '#4ade80',
      'text-2':       '#22c55e',
      'text-3':       '#166534',
      'border':       '#0a2114',
      'border-2':     '#143a25',
      'accent':       '#00ff7f',
      'accent-soft':  'rgba(0,255,127,0.10)',
      'accent-fg':    '#020806',
      'titlebar':     '#040c08',
      'disabled':     '#143a25',
    },
  },
}

// ── Mapping: shadcn token name ← source --t-* token name ───────────────────
// Per the table in issue #499.
// --destructive / --destructive-foreground and --radius intentionally omitted:
// they inherit correctly from :root / .dark via CSS cascade.

const MAPPING = [
  ['--background',           'bg'],
  ['--foreground',           'text'],
  ['--card',                 'bg-2'],
  ['--card-foreground',      'text'],
  ['--popover',              'bg-2'],
  ['--popover-foreground',   'text'],
  ['--primary',              'accent'],
  ['--primary-foreground',   'accent-fg'],
  ['--secondary',            'bg-3'],
  ['--secondary-foreground', 'text'],
  ['--muted',                'bg-3'],
  ['--muted-foreground',     'text-2'],
  ['--accent',               'accent-soft'], // alpha-composited over --t-bg per theme
  ['--accent-foreground',    'accent'],
  ['--border',               'border'],
  ['--input',                'border'],
  ['--ring',                 'accent'],
]

// ── Color math ──────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const s = hex.replace('#', '')
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ]
}

function rgbaToParts(str) {
  const m = str.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i)
  if (!m) throw new Error(`Cannot parse rgba: ${str}`)
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
}

function composite(fg, bg) {
  // Straight alpha compositing of fg over bg.
  const a = fg[3]
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
  ]
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h, s
  if (max === min) {
    h = 0
    s = 0
  } else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break
      case g: h = ((b - r) / d + 2); break
      case b: h = ((r - g) / d + 4); break
    }
    h /= 6
  }
  return [h * 360, s * 100, l * 100]
}

function fmtHsl([h, s, l]) {
  // shadcn convention: "H S% L%" with no hsl() wrapper; the wrapper lives at
  // the call site as `hsl(var(--token))`. Round to 1 decimal — sub-decimal
  // precision is below perceptible threshold and keeps the table scannable.
  const round = (n) => {
    const v = Math.round(n * 10) / 10
    return Number.isInteger(v) ? String(v) : v.toFixed(1)
  }
  return `${round(h)} ${round(s)}% ${round(l)}%`
}

function resolveValue(rawValue, bgHex) {
  if (rawValue.startsWith('rgba')) {
    // Composite over the theme's --t-bg before converting.
    const rgba = rgbaToParts(rawValue)
    const bgRgb = hexToRgb(bgHex)
    const composited = composite(rgba, bgRgb)
    return fmtHsl(rgbToHsl(composited))
  }
  return fmtHsl(rgbToHsl(hexToRgb(rawValue)))
}

// ── Render output ───────────────────────────────────────────────────────────

function renderBlock(themeName, modeName, source) {
  const bgHex = source['bg']
  const lines = []
  lines.push(`### \`.theme-${themeName}${modeName === 'dark' ? '.dark' : ''}\``)
  lines.push('')
  lines.push('```css')
  lines.push(`.theme-${themeName}${modeName === 'dark' ? '.dark' : ''} {`)
  for (const [shadcnName, sourceKey] of MAPPING) {
    const sourceVal = source[sourceKey]
    const hslVal = resolveValue(sourceVal, bgHex)
    const comment = sourceVal.startsWith('rgba')
      ? `  /* ← --t-${sourceKey} composited over --t-bg (${sourceVal} on ${bgHex}) */`
      : `  /* ← --t-${sourceKey} ${sourceVal} */`
    lines.push(`  ${shadcnName}: ${hslVal};${comment}`)
  }
  lines.push('}')
  lines.push('```')
  lines.push('')
  return lines.join('\n')
}

const header = `# Theme tokens — translated

> **Generated by \`convert-tokens.mjs\`.** Do not edit by hand. Re-run the script after editing \`themes.css\` source values:
>
> \`\`\`bash
> node docs/design/v1.2-appearance/convert-tokens.mjs
> \`\`\`

Source: the 14 \`--t-*\` tokens per theme/mode in \`docs/design/v1.2-appearance/themes.css\`.

Target: shadcn HSL token names (\`H S% L%\` triplets, no \`hsl()\` wrapper — the wrapper lives at call sites as \`hsl(var(--token))\`).

The four blocks below are pasted verbatim into \`src/renderer/index.css\` under \`@layer base\` after the existing \`:root\` / \`.dark\` blocks. Mono is the implicit baseline (\`:root\` + \`.dark\` untouched), so only Prose and Termy emit overrides.

\`--destructive\`, \`--destructive-foreground\`, and \`--radius\` are intentionally omitted — they inherit correctly from \`:root\` / \`.dark\` via the cascade.

For tokens sourced from an \`rgba\` value (currently only \`--accent\` ← \`--t-accent-soft\`), the script composites the rgba over the theme's \`--t-bg\` before converting to HSL. The comment alongside each declaration shows the source value and (where applicable) the compositing inputs.

---

`

const blocks = [
  renderBlock('prose', 'light', SOURCE.prose.light),
  renderBlock('prose', 'dark',  SOURCE.prose.dark),
  renderBlock('termy', 'light', SOURCE.termy.light),
  renderBlock('termy', 'dark',  SOURCE.termy.dark),
]

writeFileSync(OUT, header + blocks.join('\n'))
console.log(`Wrote ${OUT}`)
