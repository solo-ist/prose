# QoL Pass 2 — HITL verification checklist

Merge log + manual-QA checklist for the QoL Pass 2 cloud-orchestration wave
(brief: [`qol-pass-2-proof-wave.md`](qol-pass-2-proof-wave.md)). All 10 PRs were
reviewed, fixed where needed, and squash-merged to `main` on **2026-06-13**.
Run this pass against a fresh `npm run dev` before cutting the point release.

**State at merge:** `main` @ `72605bb`. Branch protection requires `e2e` only;
every PR below merged green on `e2e` + a clean `claude[bot]` review.
**Scope vs. brief:** the brief scoped 12 issues; this wave merged 9 of them (all
8 of Batch 1, plus #724 from Batch 2) as 9 feature PRs + the #751 skills chore =
10 PRs. **Deferred (not dispatched/opened this wave):** #722 (per-mode light/dark
theme), #727 (ENOENT-on-save → Save-As fallback), #701 (customizable kebab menus)
— all Batch-2, hitl-full, carried to a later wave.
**Dependabot:** the only new advisory (transitive `uuid` via `tiptap-footnotes`)
was resolved in #750 by upgrading to `tiptap-footnotes@2.0.4` (`uuid@11.1.1`);
`npm audit --omit=dev` is **0 vulnerabilities**.

> Tip: many of these touch chat, tabs, the editor, and Settings. Open a scratch
> Untitled tab / temp file for QA rather than a real document.

---

## Batch 1 — quick wins (8 PRs)

### [ ] #742 — Frontmatter Enter/Escape submit-and-advance (closes #725)
`FrontmatterEditor.tsx`
1. Open a doc with YAML frontmatter (or add `---` block at top).
2. Edit a frontmatter field; press **Enter** → commits the field and advances to the next.
3. Press **Escape** → cancels/exits the field edit cleanly.
4. Rapid double-Enter doesn't lose focus or duplicate rows.

### [ ] #743 — `/report-bug` + `/request-feature` chat slash commands (closes #716)
`ChatInput.tsx`
1. In chat, type `/` → both commands appear in the menu.
2. Run `/report-bug` and `/request-feature` → each opens the correct GitHub URL in the browser.
3. URLs are the hardcoded repo issue templates (no arbitrary URL).

### [ ] #744 — "Add to Favorites" in chat `list_files` tree (closes #728)
`ListFilesResult.tsx`
1. Ask the agent to list files (renders the `list_files` tree in chat).
2. Each file row has an "Add to Favorites" affordance mirroring the file explorer.
3. Clicking it adds to Favorites (check the sidebar); already-favorited items are idempotent (no dupes).

### [ ] #745 — Preserve caret on click promoting a preview tab (closes #729)  ⚠️ shares `Editor.tsx` with #750
`Editor.tsx`
1. Single-click a file in the explorer → opens as a **preview** tab.
2. Click into the editor body at a specific spot → caret lands where you clicked (no jump to top / no scroll reset) as the preview promotes to permanent.
3. Repeat with a fresh permanent open and after switching documents.

### [ ] #746 — Tab right-click menu: Favorites + reveal in file explorer (closes #717)
`TabBar.tsx`
1. Right-click a tab → context menu shows "Add to Favorites" and "Reveal in File Explorer" (plus existing items).
2. "Add to Favorites" adds the tab's file to Favorites.
3. "Reveal in File Explorer" highlights/scrolls to the file in the sidebar.

### [ ] #747 — Arrow-key roving tabindex for Chat/Activity tablist (closes #719)
`ChatPanel.tsx`
1. Focus the Chat/Activity tab strip (Tab key to it).
2. **Left/Right arrows** move focus between Chat and Activity tabs; only the active tab is in the tab order (roving).
3. Tabs expose `role="tab"` / `aria-selected` (already shipped); arrow nav now works for keyboard/AT users.

### [ ] #748 — Disable "Reopen Closed Tab" when stack is empty (closes #664)  🔐 privilege boundary
`src/main/menu.ts`, `src/preload/index.ts`, `App.tsx` — new IPC `menu:setReopenClosedTabEnabled` (boolean only)
1. Fresh launch with no closed tabs → **Edit/▸ menu "Reopen Closed Tab" is greyed out**.
2. Open then close a tab → menu item enables; reopen works (restores the tab).
3. Reopen until the stack empties → item greys out again.
4. (Boundary check) the new IPC only toggles enablement — no shell/FS/network.

### [ ] #749 — Sentry runtime init via Classic IPC (closes #655)  🔐 privilege boundary
`src/main/sentry.ts`
1. Settings → General → toggle **Error Reporting** on at runtime → no `init-after-ready` warning in the main-process console.
2. Toggle off/on a few times → Sentry enable/disable is clean, no warnings.
3. (Only meaningful with Sentry consent; benign otherwise.)

---

## Batch 2 + chore

### [ ] #750 — Superscript / subscript / footnotes (closes #724)  ⭐ extra scrutiny
`Editor.tsx`, `extensions/footnotes/`, `SelectionPopover.tsx`, `KeyboardShortcutsDialog.tsx`, `index.css`
**Footnote round-trip (the fixed data-loss path):**
1. Insert a footnote (**Cmd+Shift+F** or the `Fn` button in the selection popover).
2. In the footnote body, add **bold**, *italic*, a [link], and `inline code`.
3. **Save, close, reopen** the file → all formatting inside the footnote survives (this was silently stripped before the fix).
4. Multi-paragraph footnote body round-trips (continuation lines stay indented).
**Superscript / subscript** (no automated test — verify manually):
5. **Cmd+Shift+.** = superscript, **Cmd+Shift+,** = subscript; toggling one unsets the other.
6. Save/reopen → super/subscript survive (HTML pass-through).
*(Automated: `e2e/electron.footnotes.spec.ts` guards the footnote round-trip.)*

### [ ] #751 — Skills: open PRs ready, not drafts (no manual QA)
`.agents/skills/`, `.claude/skills/`, `AGENTS.md`, `docs/issues/644/cloud-environments.md`
Docs/skills only — no app behavior. (Fix applied: corrected Environment B "draft PRs only" → "draft or ready-for-review".)

---

## Pre-release gate
- [ ] All boxes above checked against a fresh `npm run dev`.
- [ ] No console errors on launch / during the flows above.
- [ ] Decide on the point-release version bump and cut the release (human action — not automated).

## Follow-ups noted during the wave
- Consider an e2e for superscript/subscript round-trip (reviewer note on #750; lower risk).
- `tiptap-footnotes` is on 2.0.4 (latest @tiptap-v2-compatible). v3.x is gated on a @tiptap v2→v3 migration — revisit with that epic, not before.
