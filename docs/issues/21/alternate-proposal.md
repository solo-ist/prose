# Issue 21: Alternate Proposal — Vendor TipTap Diff Extension

## TL;DR

Instead of building diff visualization from scratch, **vendor (copy) the `@buddhima_a/tiptap-diff-suggestions` extension** into our codebase. This gives us a working starting point for inline diff UI without the risk of depending on a small OSS package.

---

## The Problem with External Dependencies

During research, we found several options for inline diff visualization in TipTap:

| Package | Stars | Maintainers | Risk |
|---------|-------|-------------|------|
| `@buddhima_a/tiptap-diff-suggestions` | 14 | 1 | High abandonment risk |
| `prosemirror-suggestion-mode` | 36 | 1 | "WIP, still known issues" |
| `@handlewithcare/prosemirror-suggest-changes` | 43 | 7 | Requires TipTap wrapper work |
| TipTap AI Toolkit | N/A | TipTap team | $149+/month |

**None of these are ideal as dependencies:**
- The TipTap-native option (`@buddhima_a`) is too small/risky
- The ProseMirror options require wrapping work
- The paid option is overkill for MVP

---

## The Solution: Vendor and Own

Copy the `@buddhima_a/tiptap-diff-suggestions` source code directly into Prose:

```
src/renderer/extensions/diff-suggestions/
├── index.ts          # Main TipTap extension
├── types.ts          # TypeScript interfaces
├── commands.ts       # accept/reject/insertDiff commands
└── styles.css        # Baseline styles (optional)
```

### Why This Works

| Factor | Benefit |
|--------|---------|
| **License** | MIT — explicitly allows copying, modifying, distributing |
| **Size** | ~300-500 lines of actual code, 7 commits total |
| **TipTap-native** | Already uses TipTap's extension API, no wrapping needed |
| **Full control** | Can debug, extend, and modify without waiting on upstream |
| **No dependency risk** | Package can't break, disappear, or introduce vulnerabilities |

### What We Get

The extension provides exactly what the original plan needs:

```typescript
// Commands we get for free:
editor.commands.insertDiffSuggestion({ id, comment })
editor.commands.acceptDiffSuggestion(id?)
editor.commands.rejectDiffSuggestion(id?)
editor.commands.acceptAllDiffSuggestions()
editor.commands.rejectAllDiffSuggestions()

// Callbacks for integration:
onAccept: (meta) => { /* update chat message status */ }
onReject: (meta) => { /* update chat message status */ }
```

### HTML Structure (Already Defined)

```html
<span data-diff-suggestion data-diff-suggestion-id="unique-id" data-diff-suggestion-comment="reason">
  <span data-diff-suggestion-old>Original text</span>
  <span data-diff-suggestion-new>Suggested replacement</span>
</span>
```

---

## Revised Implementation Plan

### What Changes from Original Plan

| Original Plan | New Approach |
|---------------|--------------|
| Build custom diff visualization | Use vendored extension's rendering |
| Build accept/reject buttons | Use extension's built-in buttons |
| Build "Apply All" action | Use `acceptAllDiffSuggestions()` command |
| Custom diff state tracking | Extension handles this |

### What Stays the Same

- [ ] Parse SEARCH/REPLACE blocks from AI response (`editBlocks.ts`)
- [ ] Validate that `search` text exists in document
- [ ] Handle multiple matches (show error/disambiguation)
- [ ] Update system prompt for edit mode
- [ ] Track applied edits in chat store

### New Tasks

- [ ] Copy extension source from GitHub to `src/renderer/extensions/diff-suggestions/`
- [ ] Add MIT license attribution in file headers and LICENSE
- [ ] Implement `findTextInDocument()` helper to locate edit targets
- [ ] Wire `insertDiffSuggestion` to AI tool call responses
- [ ] Wire `onAccept`/`onReject` callbacks to update chat message status
- [ ] Style diff elements with Tailwind (extension is headless)

---

## Integration Flow

### 1. AI Returns Edit

```typescript
// AI tool call returns:
{
  original_text: "The quick brown fox",
  replacement_text: "The swift brown fox",
  reasoning: "More vivid language"
}
```

### 2. Apply as Diff Suggestion

```typescript
function applyEditSuggestion(edit: SuggestedEdit) {
  const { original_text, replacement_text, reasoning } = edit
  const id = generateId()
  
  // Find the text in the document
  const position = findTextInDocument(editor, original_text)
  
  if (!position) {
    return { success: false, error: 'Text not found in document' }
  }
  
  // Build diff HTML
  const diffHtml = `
    <span data-diff-suggestion 
          data-diff-suggestion-id="${id}" 
          data-diff-suggestion-comment="${escapeHtml(reasoning || '')}">
      <span data-diff-suggestion-old>${escapeHtml(original_text)}</span>
      <span data-diff-suggestion-new>${escapeHtml(replacement_text)}</span>
    </span>
  `
  
  // Replace the original text with diff markup
  editor.chain()
    .focus()
    .setTextSelection({ from: position.from, to: position.to })
    .insertContent(diffHtml)
    .run()
    
  return { success: true, id }
}
```

### 3. User Accepts/Rejects

Extension handles the UI. On accept:
- Old text is removed
- New text remains
- `onAccept` callback fires → update chat message

---

## Styling with Tailwind

```css
/* Diff container */
span[data-diff-suggestion] {
  @apply inline rounded px-1 border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950;
}

/* Original text (strikethrough) */
span[data-diff-suggestion-old] {
  @apply line-through text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30;
}

/* Replacement text (highlight) */
span[data-diff-suggestion-new] {
  @apply text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30;
}

/* Action buttons */
.diff-suggestion-action-container {
  @apply inline-flex gap-1 ml-2;
}

[data-diff-suggestion-toolbar-accept] {
  @apply px-2 py-0.5 text-xs rounded bg-green-500 text-white hover:bg-green-600;
}

[data-diff-suggestion-toolbar-reject] {
  @apply px-2 py-0.5 text-xs rounded bg-red-500 text-white hover:bg-red-600;
}
```

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/renderer/extensions/diff-suggestions/` | NEW - Vendored extension |
| `src/renderer/lib/editBlocks.ts` | SAME - Parser for SEARCH/REPLACE blocks |
| `src/renderer/lib/applyEdit.ts` | SIMPLIFIED - Just find text + insert diff HTML |
| `src/renderer/components/chat/EditBlock.tsx` | SIMPLIFIED - Mini preview, link to diff in doc |
| `src/renderer/components/chat/ChatMessage.tsx` | SAME - Detect and render edit blocks |
| `src/renderer/lib/prompts.ts` | SAME - Add edit instructions |
| `src/renderer/stores/chatStore.ts` | SAME - Track applied edits |
| `src/renderer/styles/diff-suggestions.css` | NEW - Tailwind styles |

---

## Attribution

Add to vendored files:

```typescript
/**
 * Diff Suggestions Extension for TipTap
 * 
 * Originally from: https://github.com/bsachinthana/tiptap-diff-suggestions
 * Author: Buddhima Sachinthana (@buddhima_a)
 * License: MIT
 * 
 * Vendored and modified for Prose by solo.ist
 */
```

---

## Key Implementation Details to Understand

Before modifying, understand these three things in the vendored code:

1. **Mark schema** — How `data-diff-suggestion`, `data-diff-suggestion-old`, `data-diff-suggestion-new` are defined as TipTap marks
2. **`insertDiffSuggestion` command** — How it handles cursor position and HTML insertion
3. **Accept/reject logic** — How it swaps old→new (accept) or new→old (reject) and removes the wrapper

Once you grok these, you own it completely.

---

## Future Flexibility

With vendored code, we can later:

- Add "preview diff in margin" like VS Code
- Support block-level diffs (not just inline text)
- Add "Apply All" with progress indicator
- Integrate with undo stack more deeply
- Switch to a different visual style entirely

No waiting on upstream, no PRs, no npm updates breaking things.

---

## Decision

**Recommendation**: Vendor the extension. It's the pragmatic choice for a DIY project — you get a working starting point without the baggage of an external dependency from a single maintainer.

---

## Source

- GitHub: https://github.com/bsachinthana/tiptap-diff-suggestions
- npm: https://www.npmjs.com/package/@buddhima_a/tiptap-diff-suggestions
- License: MIT
