# Human Suggesting mode QA handoff

## Scope

This branch adds a deliberately small human track-changes workflow on top of the existing MCP review system.

It supports one local human and one agent working through the same suggestion lifecycle. Human changes and MCP changes use the same persisted marks, review history, display modes, feedback, revision, accept, and reject commands.

The implemented human-editing scope is plain single-line text only.

Supported actions

- Toggle between Editing and Suggesting from the toolbar Pencil button
- Type text as an insertion suggestion
- Group contiguous typing into one suggestion
- Use Backspace or Delete to propose deletion of accepted text
- Replace a selected plain-text range
- Paste or cut plain single-line text
- Correct or shorten the human's own pending insertion
- Accept or reject human suggestions through the existing review controls
- List human suggestions through `list_suggestions`
- Add agent feedback through the existing suggestion tools
- Let an agent revise a pending human insertion through `revise_suggestion`
- Let either the UI or agent accept or reject the revised suggestion
- Persist and restore human inline suggestion marks

## Code-only verification already performed

The implementation was checked with focused strict TypeScript harnesses for the new TipTap extension, store interfaces, command wrappers, and TSX files. Source files were also transpiled individually to catch syntax errors.

No Electron build or Electron test run was performed during implementation.

## Commands for the testing handoff

Run these from the repository root.

```bash
npm install
npm run build
npm run typecheck:e2e
npx playwright test e2e/electron.human-suggestions.spec.ts
npx playwright test e2e/electron.mcp-tracked-changes.spec.ts
npx playwright test e2e/electron.mcp-review-collaboration.spec.ts
```

If the complete Electron suite is practical, also run:

```bash
npm run test:e2e
```

## Focused manual walkthrough

### Mode control

- Open an editable Markdown document in WYSIWYG mode
- Confirm the Pencil button says `Switch to Suggesting mode`
- Activate it and confirm `aria-pressed` becomes true and the button gains its active treatment
- Activate it again and confirm ordinary Editing mode returns
- Confirm Suggesting cannot be enabled in Source mode, a preview tab, or a read-only reMarkable document
- Confirm the Eye menu still controls review display independently

### Human insertion

- Enable Suggesting
- Type a short word or sentence
- Confirm the text appears as a green insertion suggestion
- Continue typing immediately and confirm it remains one suggestion
- Accept it and confirm the text remains while the mark disappears
- Repeat and reject it, then confirm the inserted text disappears

### Correcting an insertion

- Type `abc` in Suggesting mode
- Press Backspace once
- Confirm the same insertion suggestion now contains `ab`
- Replace part of that pending insertion and confirm it remains a single insertion suggestion
- Delete the entire pending insertion and confirm no empty pending mark remains

### Deletion

- Start with accepted text
- Enable Suggesting and press Backspace or Delete over one character
- Confirm the character remains visible with deletion styling
- Accept the suggestion and confirm the character is removed
- Repeat and reject it, then confirm the original text remains
- Select a short plain-text range and press Backspace, then check the same behaviour

### Replacement

- Select a short plain-text word
- Type replacement wording
- Confirm the original text remains marked and the proposed wording appears in the existing replacement display
- Accept and confirm the proposed wording replaces the original
- Reject and confirm the original wording remains

### Clipboard

- Paste one line of plain text and confirm it becomes an insertion suggestion
- Cut one selected line fragment and confirm it becomes a deletion suggestion while the clipboard still receives the selected text

### Persistence

- Create each human suggestion type
- Save or switch tabs
- Reopen the document
- Confirm the suggestion restores with its ID, type, proposed wording, and human attribution
- Confirm acceptance or rejection after restoration removes the pending record rather than resurrecting it on another reload

### Human and agent workflow

- Create a human insertion
- From the agent, call `list_suggestions` and confirm attribution reports a human UI change
- Add feedback with `add_suggestion_feedback`
- Revise the insertion with `revise_suggestion`
- Confirm the human version becomes superseded and the revised version is pending with agent attribution
- Accept or reject the revised version with `decide_suggestion`
- Confirm `list_review_events` records creation, revision, and decision in order

### Existing MCP regression checks

- Create MCP insertion, deletion, and replacement suggestions
- Confirm their rendering and accept/reject behaviour are unchanged
- Confirm a suggestion spanning multiple text nodes persists with its complete range after save and reload

## Deliberate MVP limits

These are expected in this version rather than release blockers.

- Paragraph breaks, Enter, and structural edits are not tracked
- Rich-text or formatting-only changes are not tracked
- Multi-line paste and cut fall back to direct editing
- Modifier-based word deletion falls back to direct editing
- Block movement, tables, images, lists, and headings are not supported as human suggestions
- Editing inside another unresolved suggestion is blocked rather than merged
- The mode is local and session-scoped rather than persisted as document state
- Full concurrent multi-human collaboration is not supported
- Undo and redo need hands-on verification and may remain a follow-up
- Human inline restoration uses nearby text matching, so repeated identical text deserves a manual check

## Suggested acceptance threshold

This MVP is ready for ordinary use when the focused human-suggestion spec passes, the two existing MCP review specs remain green, and the manual insertion, deletion, replacement, reload, and agent-revision walkthroughs behave as described.
