# Persistence Strategy: Drafts & Chat History

## Overview

Add persistence for unsaved document drafts and per-file chat history using IndexedDB (works in both Electron and web, with virtually unlimited storage).

## Key Design Decisions

1. **Document UUIDs**: Add `documentId` to `Document` type - stable identifier that survives renames and works for unsaved files
2. **IndexedDB for all persistence**: Cross-platform, no IPC needed, large capacity (no 5-10MB localStorage limits)
3. **Chat history per document**: Keyed by `documentId`, multiple conversations per file
4. **Draft recovery setting**: Default silent recovery, with option to prompt

---

## Data Structures

### Document (updated)
```typescript
interface Document {
  documentId: string        // NEW: UUID, generated on create
  path: string | null
  content: string
  frontmatter: Record<string, unknown>
  isDirty: boolean
}
```

### Chat Conversation
```typescript
interface ChatConversation {
  id: string                // UUID
  documentId: string        // Links to document
  messages: ChatMessage[]
  createdAt: number         // timestamp
  updatedAt: number         // timestamp
  title?: string            // Auto-generated from first message
}
```

### Draft State
```typescript
interface DraftState {
  document: Document        // Full document including documentId
  cursorPosition?: { line: number; column: number }
  activeChatId: string | null
  savedAt: number
}
```

### Settings (updated)
```typescript
interface Settings {
  // ... existing
  recovery: {
    mode: 'silent' | 'prompt'  // Default: 'silent'
  }
}
```

### IndexedDB Schema
```
Database: prose-db
Object Stores:
  - drafts: { key: 'current', value: DraftState }
  - conversations: { key: documentId, value: ChatConversation[] }
```

---

## Files to Modify/Create

### New Files
- `src/renderer/lib/persistence.ts` - Core persistence functions (IndexedDB wrapper)

### Modified Files
- `src/renderer/types/index.ts` - Add `documentId` to Document, add ChatConversation type, update Settings
- `src/renderer/stores/editorStore.ts` - Add documentId generation, draft persistence
- `src/renderer/stores/chatStore.ts` - Add conversation management, persistence hooks
- `src/renderer/hooks/useEditor.ts` - Integrate chat save/load on file operations
- `src/renderer/components/chat/ChatPanel.tsx` - Add chat history UI
- `src/renderer/components/settings/SettingsDialog.tsx` - Add recovery mode setting

---

## Implementation Steps

### Phase 1: Persistence Layer
1. Create `persistence.ts` with IndexedDB wrapper:
   - `initDB()` - Initialize/open database
   - `generateId()` - UUID generation
   - `saveDraft(state)` / `loadDraft()` / `clearDraft()`
   - `saveConversations(documentId, conversations)` / `loadConversations(documentId)`
   - `deleteConversations(documentId)` - For cleanup when drafts are discarded

### Phase 2: Document Identity
1. Add `documentId: string` to Document type
2. Update `editorStore`:
   - Generate UUID in `resetDocument()` (new file)
   - Preserve documentId in `setDocument()`
   - Add draft persistence subscription (debounced)
   - Add `hydrateFromDraft()` for recovery

### Phase 3: Chat Conversations
1. Add `ChatConversation` type
2. Update `chatStore`:
   - Add `conversations: ChatConversation[]` state
   - Add `activeConversationId: string | null`
   - Add `setConversations()`, `addConversation()`, `selectConversation()`
   - Messages now belong to active conversation
   - Persist on message add/update

### Phase 4: Chat History UI
1. Update `ChatPanel.tsx`:
   - Add conversation list dropdown/header showing history
   - "New Chat" button to start fresh conversation
   - Show conversation titles (auto-generated from first user message)
   - Current conversation highlighted
   - Clean, minimal UI - list only visible when clicking history button

### Phase 5: File Operation Integration
1. Update `useEditor.ts`:
   - On `openFile`: Save current conversations, load new file's conversations
   - On `newFile`: Generate new documentId, clear conversations
   - On save: Persist draft state

### Phase 6: Draft Recovery
1. Add recovery setting to Settings type and SettingsDialog
2. On app init (App.tsx):
   - Check for draft in IndexedDB
   - If `recovery.mode === 'silent'`: auto-restore
   - If `recovery.mode === 'prompt'`: show dialog
   - If draft discarded & document was unsaved: cleanup associated chats

### Phase 7: Cleanup
1. When discarding a draft for an unsaved document (no path), delete its chat history
2. Handle IndexedDB errors gracefully (catch, warn, continue)

---

## UI Mockup: Chat Panel Header

```
+-------------------------------------+
| Chat              [History v] [New] |
+-------------------------------------+
|  (dropdown when History clicked)    |
|  +-----------------------------+    |
|  | * "Help with intro..."  <-- |    |
|  |   "Refactor function..."    |    |
|  |   "Fix the bug in..."       |    |
|  +-----------------------------+    |
|                                     |
|  [Messages area]                    |
|                                     |
+-------------------------------------+
```

---

## Edge Cases

1. **Multiple tabs**: Last-write-wins for drafts (acceptable)
2. **IndexedDB errors**: Try-catch all operations, fallback gracefully
3. **Corrupted data**: Validate on load, fallback to empty state
4. **Discarding unsaved doc**: Clean up associated chat history
5. **File opened that has existing chats**: Restore most recent conversation, show history

---

## Testing Checklist

- [ ] New file -> chat -> refresh -> both content and chat restored
- [ ] Open existing file -> chat -> close -> reopen -> chat history available
- [ ] Switch files -> previous file's chat preserved
- [ ] Discard draft of new file -> associated chats deleted
- [ ] Recovery prompt setting works
- [ ] Multiple conversations per file work
- [ ] New Chat clears messages but preserves history
