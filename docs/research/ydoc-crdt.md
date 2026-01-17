# YDoc/CRDT Research: Diff Reconciliation for reMarkable Sync

## Overview

This document explores using Y.js (YDoc) and CRDTs for handling diff reconciliation between reMarkable OCR output and user edits in Prose.

## Current State

### TipTap Extensions Installed
- `@tiptap/react@2.11.2` - React integration
- `@tiptap/starter-kit@2.11.2` - Core TipTap functionality
- `@tiptap/extension-link@2.27.1` - Link support
- `@tiptap/extension-placeholder@2.27.1` - Placeholder text
- `@tiptap/pm@2.11.2` - ProseMirror core
- `tiptap-markdown@0.8.10` - Markdown serialization

### Custom Extensions
1. **DiffSuggestion** (`src/renderer/extensions/diff-suggestions/`)
   - Renders inline diff suggestions with word-level highlighting
   - Supports accept/reject with batch operations
   - Tracks AI provenance metadata

2. **Comment** (`src/renderer/extensions/comments/`)
   - User comments on selections

3. **AIAnnotations** (`src/renderer/extensions/ai-annotations/`)
   - Tracks AI-generated changes with visual decorations

### Current Document Model
```
Editor State Flow:
  TipTap Editor (ProseMirror)
       ↓
  Zustand editorStore (string-based)
       ↓
  Debounced save (500ms) to file system
```

- **Single-writer model**: Changes flow from editor → store → file
- **External updates**: Full content replacement via `editor.commands.setContent()`
- **No operational transformation**: Direct content replacement can lose user edits

## The Problem

When a user has edited local markdown and the reMarkable notebook is updated:
1. Current sync would overwrite local edits with new OCR output
2. No mechanism to merge changes intelligently
3. User work could be lost

## Y.js/CRDT Solution Analysis

### What is Y.js?

Y.js is a CRDT (Conflict-free Replicated Data Type) implementation that enables:
- Automatic conflict resolution
- Multi-client synchronization
- Offline-first editing
- Efficient binary state snapshots

### TipTap + Y.js Integration

TipTap natively supports Y.js via `y-prosemirror`:
```bash
npm install yjs y-prosemirror
```

The binding wraps the ProseMirror document in a Y.Text type, enabling:
- Operation-level change tracking
- Automatic merge of concurrent edits
- Persistent undo/redo across sessions

### Advantages for reMarkable Sync

1. **Conflict-free merging**: OCR updates merge with local edits without data loss
2. **Automatic diff tracking**: Y.js tracks changes at operation level
3. **Smart merging**: Instead of full replacement, identifies and applies only changed portions
4. **Binary snapshots**: Efficient storage of document state

### Challenges

1. **Package size**: Y.js adds ~50KB gzipped to bundle
2. **Complexity**: Replaces simple string model with CRDT operations
3. **Storage format**: Would need to store Y.js binary updates alongside markdown
4. **Migration**: Existing `.md` files need migration strategy
5. **Overkill for single-client**: Y.js shines with multi-client sync; diminishing returns for single-user app

## Alternative Approaches

### Option A: Full Y.js Integration (High Effort)

**Approach:**
1. Add `yjs` and `y-prosemirror` packages
2. Bind TipTap editor to Y.Text
3. Store Y.js update operations alongside markdown
4. On reMarkable sync, apply OCR as Y.js operations

**Pros:**
- Future-proof for collaborative features
- Most robust conflict resolution
- Efficient syncing

**Cons:**
- Significant architectural change
- Storage complexity
- ~1-2 weeks implementation

### Option B: Three-Way Merge (Medium Effort)

**Approach:**
1. Store original OCR snapshot alongside local file
2. On new sync, compute three-way merge:
   - Original OCR
   - Current user version
   - New OCR version
3. Apply merge strategy (prefer user changes for content)

**Pros:**
- Simpler than full Y.js
- Works with existing architecture
- ~2-3 days implementation

**Cons:**
- Less sophisticated conflict resolution
- Requires storing reference copies
- May struggle with complex conflicts

### Option C: Enhanced Diff Suggestions (Low Effort)

**Approach:**
1. When OCR returns new content, compute diff against current editor
2. Display changes as inline DiffSuggestion nodes
3. User reviews and accepts/rejects word-by-word
4. Leverages existing DiffSuggestion extension

**Pros:**
- Uses existing infrastructure
- User has explicit control
- ~1 day implementation
- No architectural changes

**Cons:**
- Requires user interaction for every sync
- May be tedious for large changes
- Not automatic

## Recommendation

**Start with Option C (Enhanced Diff Suggestions)** for immediate needs:
- Builds on existing DiffSuggestion extension
- Gives user explicit control over merging
- Minimal implementation effort
- Can evolve to Option B or A later if needed

**Consider Option A (Full Y.js)** if:
- Planning to add real-time collaboration features
- Users frequently have large sync conflicts
- Offline-first editing becomes a priority

## Implementation Notes

### For Option C (Enhanced Diff Suggestions)

1. When reMarkable sync returns new OCR content:
```typescript
const currentContent = editor.storage.markdown.getMarkdown()
const newOCRContent = await ocrResult

if (currentContent !== newOCRContent) {
  // Compute word-level diff
  const diffs = computeWordDiff(currentContent, newOCRContent)

  // Insert as DiffSuggestion nodes
  for (const diff of diffs) {
    editor.commands.insertDiffSuggestion({
      oldText: diff.removed,
      newText: diff.added,
      position: diff.position
    })
  }
}
```

2. User reviews suggestions in editor, accepting or rejecting each change

3. After review, save the merged content

### For Future Y.js Integration

Key files to modify:
- `src/renderer/components/editor/Editor.tsx` - Add Y.js provider
- `src/renderer/stores/editorStore.ts` - Replace string content with Y.Doc
- `src/main/remarkable/sync.ts` - Apply OCR as Y.js operations

## References

- [Y.js Documentation](https://docs.yjs.dev/)
- [y-prosemirror](https://github.com/yjs/y-prosemirror)
- [TipTap Collaboration Extension](https://tiptap.dev/docs/editor/extensions/functionality/collaboration)
- [Three-Way Merge Algorithm](https://www.gnu.org/software/diffutils/manual/html_node/diff3-Merging.html)
