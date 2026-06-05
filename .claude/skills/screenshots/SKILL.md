---
name: screenshots
description: Generate the README hero + Mac App Store marketing screenshots (retina, Prose theme, light/dark) via Playwright.
---

# Marketing Screenshot Generator

Produces the README hero and the Mac App Store screenshot set from a clean,
isolated, seeded Prose instance — deterministic, retina (2560×1600), no private
data, no live API calls. Built on the e2e Playwright harness.

## What it produces

| Output | Scene (App Store copy) | Mode |
|---|---|---|
| `01-hero-editor.png` (also the README hero) | Hero — post + **Projects** explorer | ☀️ Light |
| `02-ai-chat.png` | AI Alongside You — chat + mode-switch card | 🌙 Dark |
| `03-review-diffs.png` | Review Every Suggestion — Quick Review | ☀️ Light |
| `04-edits-history.png` | Edits History — the **Activity** panel | 🌙 Dark |
| `05-projects-favorites.png` | Projects & Favorites — Favorites view | ☀️ Light |

Light hero, then alternating dark/light. Scenes mirror the shot list in
[`docs/app-store-copy.md`](../../../docs/app-store-copy.md). Keep that copy and
this generator in sync when the shot list changes.

## Files

| File | Purpose |
|---|---|
| `e2e/electron.screenshots.spec.ts` | Scenes 1, 3, 4, 5 — isolated profile, seeded projects/favorites + the blog fixture |
| `e2e/electron.screenshot-chat.spec.ts` | Scene 2 — the chat mode-switch, injected deterministically (no live AI) |
| `e2e/fixtures/a-chorus-of-human-voices.md` | Demo document (a real blog post). Frontmatter is stripped at runtime so the title leads; a few obvious typos are injected below the fold for the review/activity demos |
| `docs/app-store-screenshots/` | Destination for the App Store set |
| `docs/images/prose-screenshot.png` | Destination for the README hero (= scene 1) |

Both specs are **excluded from the normal e2e run** — they self-skip unless
`SHOOT=1` is set (`test.skip(process.env.SHOOT !== '1', …)`).

## Run

```bash
# 1. Free port 9222 — the dev build binds it; a running dev server blocks the
#    screenshot instance. Stop it first (PID file), restart when done.
kill "$(cat .dev.pid)" 2>/dev/null

# 2. Build (the specs launch the built app at out/main/index.js).
npm run build

# 3. Generate → writes to /tmp/prose-shots/
SHOOT=1 npx playwright test electron.screenshots electron.screenshot-chat --workers=1

# 4. Review every shot before committing (they're marketing assets).
open /tmp/prose-shots/*.png

# 5. Place into the repo.
cp /tmp/prose-shots/0{1,2,3,4,5}-*.png docs/app-store-screenshots/
cp /tmp/prose-shots/01-hero-editor.png docs/images/prose-screenshot.png
```

Inspect each PNG (e.g. with the Read tool) and iterate — re-run a single scene
with `... electron.screenshots -g "03 review" --workers=1`.

## How it works

- **Isolated profile** — each spec seeds a throwaway `PROSE_USER_DATA_DIR` with
  `settings.json` (Prose theme `color: 'prose'`, projects/favorites, a fake
  `llm.apiKey` so the chat renders *configured*, `aiConsent`). No private data,
  reproducible.
- **Retina** — the window is set to **1280×800** logical; on a retina Mac that
  captures at **2560×1600** (DSF 2), the App Store spec. Verify with
  `sips -g pixelWidth -g pixelHeight`.
- **Theme** — `color: 'prose'` (the gold theme; *not* the `mono` default).
  Light/dark per scene via the `dark` class on `<html>`.
- **Seeded content via test seams** (always-on, see `src/renderer/main.tsx`):
  - `window.__prose_tools.executeTool(name, args, mode, provenance?)` — drive
    `open_file`, `suggest_edit` (pass `provenance.model` so the Activity panel
    shows a real model, not "Unknown"), `add_comment`, `accept_diff`.
  - `window.__prose_chat` — seed a conversation + inject messages. Scene 2's
    mode-switch is an assistant message whose `content` carries a real
    `<tool-result name="request_mode_switch" success="true">{json}</tool-result>`
    tag, so the rendered card is the actual `RequestModeSwitchResult` component.

## Gotchas

- **Live AI can't be automated.** The real API key lives in the OS Keychain;
  `safeStorage` is unavailable to the Playwright-launched Electron, so a fresh
  automated run can't read it. Scene 2 is therefore *mocked* (the card is the
  real component with scripted content) — visually identical to a live exchange.
  Don't try to wire a live call; if you must, you'd seed a plaintext key into
  the profile's `settings.json` (`ipc.ts` reads `settings.llm.apiKey` first).
- **Port 9222.** The unpackaged build runs in dev mode and binds the DevTools
  port; a running dev server (or a second screenshot run) collides. One at a time.
- **Don't `open -a Prose`** while generating — it launches the *installed* app,
  which shares `userData` on the case-insensitive filesystem and fights the
  single-instance lock.
- **Demo content** — to change the document, replace the fixture (keep it a real,
  on-brand piece). Typos for the review/activity scenes are injected at runtime
  in `electron.screenshots.spec.ts` (`heroBody.replace(...)`), not in the fixture.

## Updating the App Store set

The shot list is owned by `docs/app-store-copy.md` (issue #612 owns the assets).
If a scene is added/removed/renamed there, update the spec scenes and this table,
regenerate, and replace the files in `docs/app-store-screenshots/`.
