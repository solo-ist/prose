# Agentic Editing Mode - Implementation Plan

## Overview

Enable AI to propose edits that appear as inline diffs in the document. Users accept/reject changes directly in the editor, like Google Docs suggestions.

## Approach

**Vendor the `@buddhima_a/tiptap-diff-suggestions` extension** — copy the MIT-licensed source into our codebase for full control without dependency risk.

---

## Edit Block Format (AI Output)

```
<<<<<<< SEARCH
The quick brown fox jumps over the lazy dog.
=======
The swift brown fox leaps over the sleeping dog.
>>>>>>> REPLACE
```

When parsed, this becomes an inline diff in the document:

```
[The quick brown fox jumps over the lazy dog.][The swift brown fox leaps over the sleeping dog.] [✓] [✗]
 ↑ strikethrough red                              ↑ highlighted green
```

---

## Implementation Steps

### Step 1: Vendor the Diff Extension

**New directory:** `src/renderer/extensions/diff-suggestions/`

Copy from https://github.com/bsachinthana/tiptap-diff-suggestions:
- `index.ts` - Main TipTap extension
- `types.ts` - TypeScript interfaces
- `commands.ts` - accept/reject/insertDiff commands

Add attribution header:
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

### Step 2: Create Edit Block Parser

**New file:** `src/renderer/lib/editBlocks.ts`

```typescript
interface EditBlock {
  id: string
  search: string
  replace: string
}

function parseEditBlocks(content: string): EditBlock[]
function hasEditBlocks(content: string): boolean
```

- Parse `<<<<<<< SEARCH` ... `=======` ... `>>>>>>> REPLACE`
- Handle multiple blocks per message
- Generate unique IDs

### Step 3: Create Text Finder + Diff Applier

**New file:** `src/renderer/lib/applyEdit.ts`

```typescript
interface ApplyResult {
  success: boolean
  error?: string
  matchCount?: number
  diffId?: string
}

function findTextInDocument(editor: Editor, search: string): { from: number, to: number } | null

function applyEditAsDiff(
  editor: Editor,
  search: string,
  replace: string,
  reason?: string
): ApplyResult
```

Implementation:
1. Find `search` text position using TipTap doc traversal (like FindBar)
2. Build diff HTML with `data-diff-suggestion` markup
3. Replace original text with diff markup via `insertContent`

### Step 4: Register Extension in Editor

**Modify:** `src/renderer/components/editor/Editor.tsx`

```typescript
import { DiffSuggestions } from '@/extensions/diff-suggestions'

const editor = useEditor({
  extensions: [
    // ... existing extensions
    DiffSuggestions.configure({
      onAccept: (meta) => handleDiffAccepted(meta),
      onReject: (meta) => handleDiffRejected(meta),
    }),
  ],
})
```

### Step 5: Style Diff Elements

**New file:** `src/renderer/styles/diff-suggestions.css`

```css
/* Diff container */
span[data-diff-suggestion] {
  @apply inline rounded px-0.5 border border-blue-300 bg-blue-50
         dark:border-blue-700 dark:bg-blue-950;
}

/* Original text (strikethrough) */
span[data-diff-suggestion-old] {
  @apply line-through text-red-600 bg-red-100
         dark:text-red-400 dark:bg-red-900/30;
}

/* Replacement text (highlight) */
span[data-diff-suggestion-new] {
  @apply text-green-700 bg-green-100
         dark:text-green-400 dark:bg-green-900/30;
}

/* Action buttons */
[data-diff-suggestion-toolbar-accept] {
  @apply px-1.5 py-0.5 text-xs rounded bg-green-600 text-white
         hover:bg-green-700 cursor-pointer;
}

[data-diff-suggestion-toolbar-reject] {
  @apply px-1.5 py-0.5 text-xs rounded bg-red-600 text-white
         hover:bg-red-700 cursor-pointer;
}
```

### Step 6: Update ChatMessage to Trigger Diffs

**Modify:** `src/renderer/components/chat/ChatMessage.tsx`

When rendering assistant messages:
1. Detect edit blocks with `hasEditBlocks(content)`
2. Show "Apply Edits" button if blocks found
3. On click: parse blocks, apply each as inline diff
4. Show status: "3 edits applied to document"

### Step 7: Add Chat Controls for Bulk Actions

**Modify:** `src/renderer/components/chat/ChatPanel.tsx` or new component

- "Accept All" button → `editor.commands.acceptAllDiffSuggestions()`
- "Reject All" button → `editor.commands.rejectAllDiffSuggestions()`
- Show count of pending diffs

### Step 8: Update System Prompt

**Modify:** `src/renderer/lib/prompts.ts`

When document is included, add:
```
When suggesting edits to the document, use this exact format:

<<<<<<< SEARCH
[exact text to find - must match precisely]
=======
[replacement text]
>>>>>>> REPLACE

Include enough surrounding context in SEARCH to ensure a unique match.
```

### Step 9: Wire Accept/Reject to Chat State

**Modify:** `src/renderer/stores/chatStore.ts`

Track which edits from which messages have been accepted/rejected:
```typescript
interface AppliedEdit {
  diffId: string
  messageId: string
  status: 'pending' | 'accepted' | 'rejected'
}
```

Update chat message UI to reflect edit status.

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/renderer/extensions/diff-suggestions/` | NEW - Vendored TipTap extension |
| `src/renderer/lib/editBlocks.ts` | NEW - Parse SEARCH/REPLACE blocks |
| `src/renderer/lib/applyEdit.ts` | NEW - Find text + apply as diff |
| `src/renderer/styles/diff-suggestions.css` | NEW - Tailwind styles for diffs |
| `src/renderer/components/editor/Editor.tsx` | MODIFY - Register extension |
| `src/renderer/components/chat/ChatMessage.tsx` | MODIFY - "Apply Edits" button |
| `src/renderer/components/chat/ChatPanel.tsx` | MODIFY - Accept/Reject All |
| `src/renderer/lib/prompts.ts` | MODIFY - Edit instructions |
| `src/renderer/stores/chatStore.ts` | MODIFY - Track edit status |

---

## User Flow

1. User asks AI to make changes (with "Include document" checked)
2. AI responds with SEARCH/REPLACE blocks
3. Chat shows "Apply 3 edits to document" button
4. User clicks → edits appear as inline diffs in editor
5. User reviews each diff in context
6. User accepts/rejects individually or uses "Accept All"
7. Chat updates to show "3 edits accepted"

---

## Edge Cases

1. **Search text not found** → Show error in chat, don't apply
2. **Multiple matches** → Apply to first match, warn user
3. **Empty search/replace** → Validate and reject
4. **Overlapping edits** → Apply in order, each works on current doc state
5. **User edits during pending diff** → Diff may become invalid, handle gracefully

---

## Implementation Order

1. Vendor extension → get it compiling
2. Register in Editor → verify it loads
3. Add styles → make diffs visible
4. `editBlocks.ts` → parse AI output
5. `applyEdit.ts` → find text + insert diff HTML
6. ChatMessage integration → "Apply Edits" button
7. Accept/reject callbacks → update chat state
8. System prompt → instruct AI
9. Polish & edge cases

---

## Testing Plan

1. Single edit block → appears as inline diff
2. Multiple edit blocks → all appear, can accept individually
3. Accept → old text removed, new text stays
4. Reject → new text removed, old text restored
5. Accept All → all diffs resolved
6. Not found → error shown, no diff inserted
7. Undo after accept → TipTap undo works
