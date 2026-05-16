# feat(appearance): unified Theme + App Icon picker

> Replace the silent shadcn dark/light toggle with a real **Appearance** settings pane:
> **Mode** (Light · Dark · System) · **Color** (Termy · Prose · Mono) · **App Icon** (11 options).
> Default lands on `Prose · Dark · Pilcrow ¶` — paper-warm cream + muted gold + the paragraph mark.

**Labels:** `feat` · `appearance` · `settings` · `ux`
**Milestone:** v1.1
**Visual reference:** `App Logo Picker.html`, `Prose Theme.html`, `App Logo.html`, `themes.css`, `prose-icons.jsx`

---

## Why

The marketing site (`solo.ist`, `solo.ist/prose`) is dark, paper-warm, set in IBM Plex Mono with Fraunces italic flourishes, and uses a single muted-gold accent (`#c8a45a`). The shipped app is cool shadcn-neutral (`240` hue, near-pure white in light mode) with no gold, no italic, and no continuity with the brand. The legacy icon is a CRT-green pixel P. that reads as a 90s terminal, not a typographer's tool.

Result: launching Prose feels like opening a different product than the one the manifesto promised. This issue closes the gap and adds a small amount of *taste* — pick your palette and your dock mark without leaving the editor.

---

## Scope

Three controls, one pane, in `Settings → Appearance`.

### 1. Mode

`Light` · `Dark` · `System` — segmented control. **Default: Dark.**
`System` listens to `window.matchMedia('(prefers-color-scheme: dark)')` *and* `nativeTheme.shouldUseDarkColors` (over IPC) and updates live without a restart.

### 2. Color

Three themes, each fully defined for light + dark. **Default: Prose.**

| id | name | one-liner | accent (dark) | bg (dark) | accent (light) | bg (light) |
|---|---|---|---|---|---|---|
| `prose` | **Prose** | paper + gold (default) | `#c8a45a` | `#0a0a0a` | `#9a7a3e` | `#f4eee5` |
| `mono`  | **Mono**  | shadcn neutral (legacy 1.0) | `#fafafa` | `#09090b` | `#18181b` | `#ffffff` |
| `termy` | **Termy** | phosphor green · deep cut | `#00ff7f` | `#020806` | `#1d6b34` | `#eaf1de` |

Termy dark also gets a faint `text-shadow` phosphor glow and a 1px scanline overlay (`repeating-linear-gradient`) — see `themes.css`.

### 3. App Icon

11 marks, all macOS squircles (22.37% radius), all built from the brand's existing material — Plex Mono Thin, Fraunces italic, cream `#e3dbd1` + gold `#c8a45a`. **Default: Pilcrow ¶.** Source: `prose-icons.jsx`.

| id | name | rationale |
|---|---|---|
| `pilcrow` | **Pilcrow ¶** (default) | the paragraph mark — used by prose typographers since the 12th century. Fraunces italic. |
| `refined-p` | Refined P. | Plex Mono Thin · cream P + gold period · the wordmark made into a mark |
| `fraunces-p` | Italic P | Fraunces italic — the signature italic-in-mono move |
| `p-ist` | p.ist lockup | mini wordmark — "p" + ".ist" stacked |
| `asterisk` | Asterisk * | markdown emphasis |
| `hash` | Hash # | markdown heading |
| `em-dash` | Em dash + period | the brand's signature punctuation |
| `caret` | Cursor block (`a\|`) | the editor caret, frozen |
| `period` | The period | reductive · atom of the brand · radial glow |
| `prompt` | Prompt `>_` | terminal lineage · agent-accessible |
| `legacy` | Legacy 1.0 | the original green pixel P. — keep it as a deep cut |

---

## Tokens

A single `src/renderer/themes.css` defines 14 tokens × 3 themes × 2 modes (84 values). Scope via data attributes on the root: `<html data-theme="prose" data-mode="dark">`. Full file is in the design project — copy verbatim, no edits.

```css
[data-theme="prose"][data-mode="dark"] {
  --t-bg:        #0a0a0a;
  --t-bg-2:      #16140f;
  --t-bg-3:      #0d0c0a;
  --t-text:      #e3dbd1;
  --t-text-2:    #7d7770;
  --t-text-3:    #4a4641;
  --t-border:    #1d1d1d;
  --t-border-2:  #2c2a26;
  --t-accent:    #c8a45a;
  --t-accent-soft: rgba(200,164,90,0.10);
  --t-accent-fg: #0a0a0a;
  --t-titlebar:  #1c1a17;
  --t-disabled:  #2c2a26;
  --t-window-shadow: 0 40px 100px rgba(0,0,0,0.65);
}
/* …prose-light, mono-light, mono-dark, termy-light, termy-dark — see themes.css */
```

---

## Implementation

### Files to change in `solo-ist/prose`

| path | change |
|---|---|
| `src/renderer/index.css` | Strip shadcn `:root` / `html.dark` blocks. Import `themes.css`. Map shadcn-style usages (`hsl(var(--background))`) to the new `--t-*` tokens, OR keep shadcn names as aliases that point at `--t-*`. |
| `tailwind.config.cjs` | Re-source `colors.*` from `--t-*`. The semantic Tailwind names stay (`bg-background`, `text-foreground`); the values change. |
| `src/renderer/components/layout/App.tsx` | Apply `data-theme` + `data-mode` to `<html>` from `useAppearance()`. Drop the local `theme` state. |
| `src/renderer/components/layout/Toolbar.tsx` | The Sun/Moon button stays as a quick mode toggle, but writes to the shared appearance store (no local state). |
| `src/renderer/components/layout/StatusBar.tsx` | Tone the "saved" dot to `var(--t-accent)`; "dirty" dot to a warm `#e09040`. |
| `src/main/index.ts` | Add IPC handler `appearance:set-icon` that calls `app.dock.setIcon(nativeImage.createFromPath(...))` on macOS. |
| `electron-builder.yml` | Bundle the 11 icon PNG sets under `resources/icons/`. |

### Files to add

| path | content |
|---|---|
| `src/renderer/themes.css` | Copy from design project. |
| `src/renderer/assets/fonts/Fraunces-Italic-VariableFont.ttf` | Fraunces italic — required for the Prose theme's `em` styling and the Pilcrow icon. |
| `src/renderer/components/settings/AppearancePane.tsx` | The new pane. Three sections: Mode (segmented), Color (3 cards with nested-scope mini-previews), App Icon (6-col grid). |
| `src/renderer/components/settings/ThemeCard.tsx` | Card with nested `[data-theme][data-mode]` so the preview tile renders in *its* theme regardless of the surrounding pane. |
| `src/renderer/components/settings/IconCell.tsx` | 78px icon thumbnail + label + DEFAULT/LEGACY badges. |
| `src/renderer/hooks/useAppearance.ts` | `{theme, mode, effectiveMode, icon, setTheme, setMode, setIcon, resetAll}` — reads/writes `electron-store`, listens to `prefers-color-scheme`, applies data attrs on the root. |
| `src/renderer/lib/prose-icons.tsx` | Port the 11 icon components from `prose-icons.jsx`. |
| `resources/icons/{id}/icon-{16,32,64,128,256,512,1024}.png` | Per-icon PNG sets. Render headlessly from `prose-icons.jsx` (see below). |

### App-icon export pipeline

Single source of truth for icon shapes: `prose-icons.jsx`. Don't hand-author PNGs.

```bash
# scripts/build-icons.mjs (sketch)
# 1. spin up puppeteer
# 2. for each {id} in CATALOG:
#    for each size in [16,32,64,128,256,512,1024]:
#      render <IconShell size={N}> in a headless page
#      page.screenshot({ omitBackground: true }) → resources/icons/{id}/icon-{N}.png
# 3. (mac only) iconutil -c icns to bundle .icns sets
```

### Settings persistence

`electron-store` under key `appearance`:

```ts
type Appearance = {
  theme: 'prose' | 'mono' | 'termy';
  mode:  'light' | 'dark' | 'system';
  icon:  IconId;
};
```

Defaults for **new installs**: `{ theme: 'prose', mode: 'dark', icon: 'pilcrow' }`.
Defaults for **migrated 1.x users** (no `appearance` key present): `{ theme: 'mono', mode: <preserved>, icon: 'legacy' }` — preserve their current look exactly, then surface a one-time toast: *"You can now pick the new Prose theme and Pilcrow icon in Settings → Appearance."*

### System mode

`useAppearance` exposes `effectiveMode`:

```ts
function effective(mode: Mode, systemDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
}
```

Subscribe to both `window.matchMedia('(prefers-color-scheme: dark)')` *and* `ipcRenderer.on('native-theme:changed', …)` so it reacts to OS-level changes even if the matchMedia listener is throttled.

### Prose-theme typography hooks

When `data-theme="prose"`:

- `em` (in editor + chat) renders in Fraunces italic with `font-variation-settings: "opsz" 36, "SOFT" 30`.
- `code` (inline) gets `color: var(--t-accent); background: var(--t-accent-soft);`.
- `blockquote` gets `border-left: 2px solid var(--t-accent)` and `font-family: Fraunces, serif; font-style: italic;`.
- `h1` shifts to Plex Mono `font-weight: 200; letter-spacing: -0.03em;` — the wordmark register.

Mono and Termy keep the existing editor typography.

---

## Acceptance criteria

- [ ] `Settings → Appearance` shows Mode, Color, App Icon as three stacked sections.
- [ ] All three themes render every component — toolbar, file panel, editor, tabs, chat panel, status bar, menus, popovers — with **zero** hard-coded hex colors leaking through.
- [ ] Switching theme is ≤16ms paint, no flash, no layout shift.
- [ ] Switching mode is instant; `System` follows the OS without a restart.
- [ ] Switching icon swaps the macOS dock icon within ~200ms.
- [ ] `appearance` persists across restart and across app updates.
- [ ] Migration from 1.x defaults to `mono` + `legacy` icon to preserve the existing look.
- [ ] Prose theme: `em` is Fraunces italic; inline `code` is gold on amber.
- [ ] Termy dark: text has a phosphor `text-shadow` glow + a faint scanline overlay.
- [ ] "Reset all to default" disables itself when already at defaults.
- [ ] Color contrast meets WCAG AA for `--t-text` on `--t-bg` in all 6 theme/mode combinations.
- [ ] No regressions in diff suggestions, AI annotations, MCP/agent flows, or reMarkable sync.

---

## Out of scope (file separately)

- Custom-palette builder (user-defined themes).
- Per-window themes or per-document themes.
- Editor font family / size choice — belongs in `Settings → Editor`.
- Icon swap on Linux/Windows (no `app.dock` equivalent). Persist the preference; visual swap can land in a follow-up.
- "Ambient" mode that tints the desktop wallpaper.
- A Termy theme for the marketing site.

---

## Open questions

1. **Mono icon palette.** Should `mono` theme retone the cream+gold icon thumbnails to neutral too? Recommendation: **no** — icons are brand marks, theme is system colors.
2. **System mode as default?** Some users expect System to be the new install default. Confirm we want `Dark`.
3. **Migration UX.** Toast on first launch after upgrade, or just leave it discoverable in Settings? Recommendation: one-time toast with an "Open Settings" action.
4. **`em` outside Prose theme.** Mono and Termy users currently get plain mono italic for `em`. Acceptable, or pull Fraunces italic in for all themes?

---

## Visual references

All in the design project (link in PR):

- **`App Logo Picker.html`** — the live Settings → Appearance pane. Click through Mode/Color/Icon and watch the chrome and dock update.
- **`Prose Theme.html`** — both modes of the Prose theme rendered side-by-side, plus the full token table.
- **`App Logo.html`** — the original 10-direction exploration that produced the final 11 icons.
- **`themes.css`** — paste-ready stylesheet, all 84 token values.
- **`prose-icons.jsx`** — the 11 React icon components, source of truth for the PNG export pipeline.
