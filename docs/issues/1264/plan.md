# #1264: a click on text under the blurred editor's selection highlight is lost

Part of 1.9.1 (epic [#1230](https://github.com/solo-ist/prose/issues/1230)); found while landing A4 (#1242). Branch
`issue-1264-persistent-selection-click` from `release/v1.9.1` = `519c74d`. Renderer only.

## What the probe found (built app, real `page.mouse.click`, capture listeners on `window`)

After a chat turn's `suggest_edit`, the editor's selection covers the suggested range (`1–15`) while focus stays in
the chat textarea, so `extensions/persistent-selection` paints `span.persistent-selection` inside the
`.ai-suggestion-mark`. The first click:

1. `elementFromPoint` → `SPAN.persistent-selection`;
2. `pointerdown` and `mousedown` → `SPAN.persistent-selection`;
3. the editor takes focus, and the plugin's `focus` handler clears the decoration at once, which removes that span;
4. `pointerup` and `mouseup` → `SPAN.ai-suggestion-mark`;
5. no `click`: its mousedown target left the DOM.

`AISuggestionPopover` opens on `click`, so no card appears. On release `519c74d`, the second click opens the card. On
v1.9.0 (`2d41a6d`), the second click fails too: focus returns to the chat input, and the decoration repaints. So the
bug predates 1.9.1. Any click-driven surface over text under the highlight loses its first click the same way
(comment marks, links).

## Fix

In `extensions/persistent-selection/index.ts`:

- **Pointer focus:** a `mousedown` on the editor marks a press in progress. A `focus` during a press does not clear
  the decoration. It waits for the press to end (`pointerup` or `pointercancel` on `window`, once, in capture) and
  clears on the next task, after the browser has dispatched that press's `click` on an unchanged DOM.
- **Other focus:** keyboard focus or `editor.commands.focus()` clears at once, as today.
- **Deferred clear:** the view is checked first (`isDestroyed`), and the clear dispatches on whatever state is shown.
  The meta only resets the blur flag, so it is correct for any session's state.

## Tests

- **e2e:** A4's label case in `e2e/electron.provider-settings.spec.ts` returns to a real `mark.click()`. It must
  fail on a build of the base (`519c74d`) and pass with the fix.
- **vitest:** `extensions/persistent-selection/index.test.ts`, on a headless editor with the extension, covers
  four cases:
  1. blur with a range paints the decoration;
  2. `mousedown` then `focus` keeps it;
  3. `pointerup` then the next task clears it;
  4. a focus with no press clears it at once.
- **Baselines:** `typecheck:renderer` 66, `tsc -p tsconfig.node.json` 18, `typecheck:e2e` 6.
