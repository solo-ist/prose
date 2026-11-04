# Prose onboarding — one modal

Design package for replacing the stack of first-run dialogs (AI consent, Claude Skill, default-handler prompt) with one multi-step onboarding modal.

## Contents

- `screenshots/` — @2x renders of every step, dark theme
  - `00-first-run.png` — the modal over the "Start writing" empty state
  - `01-welcome.png` … `06-done.png` — direct build, AI on
  - `07-done-app-store-no-ai.png` — App Store build, AI declined (4 steps)
- `design-source/` — the canvas source (`.dc.html` artboards + `canvas.json`). `Onboarding.dc.html` holds every step, its copy and its state logic; the `Step*` files only set its starting props.

## Flow

| # | Step | Shown when | Writes |
|---|------|-----------|--------|
| 1 | Welcome | always | — |
| 2 | AI and privacy | always | `aiConsent {consented, consentedAt, version: 1}`, `errorTracking.enabled` |
| 3 | API key | AI chosen | key to Keychain (validated, must start `sk-ant-`) |
| 4 | Connect Claude | direct build | Skill zip download, MCP install |
| 5 | Default editor | not already default | `fileAssociation.hasBeenPrompted` (unless "Remind me later") |
| 6 | Done | always | — |

- The progress bar counts only the steps that apply (4–6).
- One modal, 520×560, alert dialog (no outside-click dismiss). No "skip setup": the AI choice must be explicit. Continue on step 2 stays disabled until a card is picked.
- Every step after 2 is skippable. Answers are held in memory and written together at Done; side effects (Skill download, MCP install, key save) happen when their button is pressed.
- Back never undoes a side effect.
- "What's new" stays a separate post-update dialog. The "Report a bug" logging prompt is unchanged.

## Open questions

- **Crash reports default.** The marketing site says crash reporting is "opt-in and off by default". The checkbox here starts checked, like the current dialog. One of them should change.
- **Escape / e2e seams.** e2e seeds `aiConsent` + `lastSeenVersion` and presses Escape on alert dialogs. Suggest: Escape is ignored on step 2 until a choice is made, and on later steps it acts as "skip to Done" and writes what's been chosen.
- **Default-editor detection.** Skip step 5 when Prose is already the default for `.md` (unknown counts as not default, as today).

## Tokens

Prose design system, Mono dark: background `#09090b`, foreground `#fafafa`, border/muted `#27272a`, muted-foreground `#a1a1aa`, accept `hsl(140 60% 55%)`, reject `hsl(0 70% 62%)`, AI violet `hsl(270 70% 60%)`, cream mark `#e2d9cb`. IBM Plex Mono for UI; Fraunces italic only for the ¶ mark and the Welcome/Done headings. Radii: buttons/inputs 6px, cards/modal 8px. Icons are lucide (`file-text`, `pen-line`, `check`, `sparkles`, `key-round`, `download`, `plug`, `eye`, `arrow-left`).
