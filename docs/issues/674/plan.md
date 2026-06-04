# #674 — Annotation robustness: detach-don't-delete + loss-path fixes

Part of the AI markdown-editing hardening plan (TestFlight v1.6.1 QA:
"accepted edits showed in the history panel, then toggling around they
disappeared, except two"). Follows #671/#672/#673.

## Loss paths fixed

| Path | Fix |
|---|---|
| `acceptAllAISuggestions` created **no annotations** | Per-suggestion params collected in the end-to-start batch loop; annotations created after `dispatch(tr)` using `tr.mapping` (range-start boundaries are step-stable; later lower-position steps shift via the accumulated mapping). Conversion results use `insertedAt`-based ranges. |
| Position mapping silently **deleted** collapsed annotations | **Detach, don't delete**: `updatePositions` / `updatePositionsWithSplitting` push `{ ...annotation, detached: true }` (keeping last-valid from/to) instead of dropping. Detached entries pass through future mapping untouched, render **no decoration** (plugin skips them), show dimmed + "superseded" badge in the history panel (jump disabled, remove still works), and persist to IndexedDB — history is an immutable per-document log. Saves fire only when a detach occurred (mapping runs per keystroke). |
| No `priorAnnotations` protection in `acceptAISuggestion` | Overlapping annotations captured pre-dispatch and passed to `createWordDiffAnnotations` (parity with `executeEdit`); unchanged words keep their provenance marks. Skipped in the batch path (needs per-step snapshots) — overlaps there detach instead of vanishing. |
| Fire-and-forget save racing tab switches | `pendingSave: Promise \| null` on the store, set by `addAnnotation`; `saveCurrentTabState` awaits it before the next document's `loadAnnotations` replaces the array. |
| `Editor.tsx` double-load race | All tab paths (`switchToTab`, `openFileInTab`, `openFileInPreviewTab` ×2, `createNewTab`, `reopenLastClosedTab`) pre-set `annotationStore.setDocumentId(newId)` **before** `setDocument(...)` so the recovery effect sees a match and doesn't fire a competing load. |
| `renameTab` orphaned annotations | documentId is SHA-256(path); rename now migrates annotations (re-keyed + `documentId` rewritten), conversations, suggestions, and comments to the new key, updates the tab/editor/annotation-store identity in-session. Old keys left in place (harmless). |

## Additional root causes found while building the spec

| Finding | Fix |
|---|---|
| **Annotation creation ran before the accept transaction applied.** TipTap applies a command's `tr` after the command body returns, so `createWordDiffAnnotations` → `addAnnotation` (which pauses position updates) executed *before* the aiAnnotations plugin mapped the transaction — the pause swallowed the mapping pass entirely. Every pre-existing annotation kept stale positions forever: collapse-detection starved (entries never detached/cleaned) and decorations drifted after each accept. | Both accept commands defer annotation creation to a `queueMicrotask` — the plugin maps (and detaches) old annotations first; the new annotation's coordinates come from `tr.mapping` and remain valid. |
| **`executeSelectTab` (select_tab tool) had drifted from `useTabs.switchToTab`**: it saved only the conversation before switching — agent-driven tab switches silently discarded the active tab's unsaved content, annotations, suggestions, and comments. Worse, the editor→store content sync is debounced 500ms (Editor.tsx onUpdate), so an agent accepting an edit and switching tabs immediately snapshotted pre-edit content and reverted the edit on toggle-back. | The executor now mirrors the full save-then-load sequence and serializes the **live editor state** (`getMarkdown()` + `serializeMarkdown`) instead of trusting the debounced `document.content`; pre-sets documentId; loads comments too. |

## Known limitations (follow-up candidates)

**Partial-collapse splits still drop the lost half quietly.** When an
insertion splits an annotation and only ONE remnant survives mapping, the
collapsed half vanishes without a history record (pre-existing behavior; the
detach-don't-delete rule fires only when BOTH remnants collapse — detaching
the original alongside a live remnant would duplicate its content in the
panel). Flagged in #677 review; revisit if partial-collapse data loss shows
up in practice.


The annotation store suppresses position mapping for ~100ms after tab and
document switches (`setLoadingDocument` + `setTimeout`). Any edit transaction
landing inside that window is excluded from mapping — existing annotations
keep pre-edit positions and collapse/detach detection doesn't run for that
transaction. Rare for humans (sub-100ms switch-then-edit), but agents hit it
(three IPC roundtrips fit inside the window — found as a CI flake in the
lifecycle spec). The spec polls `__prose_tools.isAnnotationMappingPaused()`
before asserting on mapping effects. A real fix would scope suppression to
the specific load-replacement transaction instead of wall-clock time.

## Schema note

`AIAnnotation.detached?: boolean` — optional, JSON-compatible; existing stored
annotations read as not-detached. **No DB_VERSION bump** (no object-store
change).

## Verification

`e2e/electron.ai-edit-lifecycle.spec.ts`:
- C1 single accepts (inline + block conversion) create annotations
- C2 accept-all creates one per suggestion (previously zero)
- C3a annotations survive tab toggling (count + docId stable)
- C3b overlapping accept detaches the earlier annotation (nothing vanishes)
- rename migrates to the new path-derived documentId (store + IndexedDB)
- restart: IndexedDB retains live + detached entries with a fresh app instance
