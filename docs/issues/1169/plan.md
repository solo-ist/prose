# #1169 — ⌘⇧S toggles strikethrough instead of Save As while the editor has focus

Issue: https://github.com/solo-ist/prose/issues/1169 (epic #1094 QA tail; from the PR #1165 pass, §1.3). Branch
`issue-1169-save-as-shortcut` from `release/v1.9.0`; renderer plus one declared dependency; one PR. Tranche 3
(2026-11-04).

## Mechanism, confirmed

The File menu's Save As accelerator is `CmdOrCtrl+Shift+S` (`src/main/menu.ts`), but StarterKit's Strike
extension binds `Mod-Shift-s` to `toggleStrike`, and a keydown the page handles never reaches a menu accelerator.
With a collapsed selection the stored strike mark toggles invisibly, so the key looks dead. Prose already binds
⌘⇧X to strikethrough in `Editor.tsx`.

## Change

`createEditorExtensions`: `StarterKit.configure({ strike: false })` and `Strike.extend({ addKeyboardShortcuts: () =>
({}) })` in its place, so the mark, its commands and its markdown stay and only the keymap goes. That makes
`@tiptap/extension-strike` a direct dependency (it was StarterKit's; `npm ls` shows one copy, deduped at 2.27.3).

## Tests

`e2e/electron.save-as-shortcut.spec.ts` (new): with the editor focused, `Mod-Shift-s` leaves `isActive('strike')`
false and text typed after it unstruck, while ⌘⇧X still strikes a selection; and a source-level guard that the
extension list declares `strike: false` and the keymap-less Strike, so a StarterKit update cannot bring the binding
back unnoticed. Falsified on a build of the branch base's renderer. The menu accelerator itself is main-process
behaviour the spec cannot drive; the QA block covers it.

## Execution log

- 2026-11-04: inventory (above).
