# Database Recovery Architecture Plan

**Issue**: #74 - Improve Database Recovery Behavior
**Author**: Claude + Angel Marino
**Date**: 2026-01-18

## Problem Statement

The current IndexedDB recovery mechanism (in `src/renderer/lib/persistence.ts`) uses a nuclear approach: on any database open failure, it deletes the entire database and starts fresh. This prevents the app from being completely broken but results in total data loss:

- Drafts (unsaved document content)
- Chat conversations and history
- AI annotations on documents
- Command history

For a writing tool evolving into a memex (personal knowledge management system), this data loss is increasingly unacceptable as users build up valuable context, conversations, and annotations over time.

## Goals

### Short-term (Pragmatic Fix)
1. **Preserve as much data as possible** during recovery
2. **Provide user visibility** into what happened and what was recovered/lost
3. **Maintain reliability** - app must load, never completely break
4. **Quick to implement** - address the annoying bug without over-engineering

### Long-term (Memex Vision)
1. **Support future vector store** integration for semantic search and retrieval
2. **Enable data export/import** for user control and portability
3. **Build foundation for sync** (cloud backup, multi-device)
4. **Incremental migration path** as schema evolves

## Current Architecture Analysis

### Database Schema (v3)
```typescript
const STORES = {
  DRAFTS: 'drafts',              // Single key 'current' -> DraftState
  CONVERSATIONS: 'conversations', // documentId -> ChatConversation[]
  ANNOTATIONS: 'annotations',     // documentId -> AIAnnotation[]
  COMMAND_HISTORY: 'command_history' // Single key 'history' -> Record<string, string[]>
}
```

### Current Recovery Logic
Located in `src/renderer/lib/persistence.ts:87-154`

```typescript
function getDB(): Promise<IDBDatabase> {
  // ...
  request.onerror = async () => {
    if (!recoveryAttempted) {
      recoveryAttempted = true
      await deleteDatabase()  // Nuclear option
      const retryDb = await getDB()
      resolve(retryDb)
    }
  }
}
```

**Issues with Current Approach:**
1. Zero data preservation attempt
2. No user notification
3. Silent failure - users discover data loss gradually
4. No forensics - can't diagnose why corruption occurred
5. No distinction between recoverable vs. catastrophic errors

## Proposed Solution: Tiered Recovery Strategy

### Tier 1: Backup-First Recovery (Immediate Implementation)

**Goal**: Preserve data before attempting any destructive recovery.

#### 1.1 Automatic Backups
- **Pre-recovery backup**: Before deleting DB, export all accessible data to IndexedDB backup store or localStorage
- **Periodic snapshots**: Daily automatic exports to JSON files in `~/.prose/backups/` (via Electron IPC)
- **Backup retention**: Keep last 7 days, auto-prune older

#### 1.2 Graceful Recovery
Instead of immediate deletion, attempt:
```typescript
1. Try to open DB in readonly mode to export data
2. Attempt store-by-store recovery (some stores may be accessible)
3. Save recovery metadata (timestamp, error type, what was recovered)
4. Only then delete and recreate
5. Attempt to restore from backup
```

#### 1.3 User Notification
- Show recovery modal on app launch if recovery occurred
- Display what was lost vs. recovered
- Offer to view backup files or restore manually
- Include recovery log for debugging

### Tier 2: Resilient Schema Design (Foundation for Vector Store)

**Goal**: Design schema to minimize corruption impact and support future vector store.

#### 2.1 Store Isolation
Instead of single database, use multiple databases:
```typescript
// Separate databases reduce blast radius
'prose-drafts-db'        // Critical: current document state
'prose-conversations-db' // Important: chat history
'prose-annotations-db'   // Important: AI annotations
'prose-metadata-db'      // Low-risk: command history, UI state
'prose-vector-db'        // Future: embeddings and semantic index
```

**Benefits:**
- Corruption in one DB doesn't affect others
- Independent versioning and migration
- Easier to implement partial recovery
- Natural separation for future vector store

#### 2.2 Versioned Document Format
Prepare for vector store by structuring documents with embeddings:
```typescript
interface PersistedDocument {
  version: 2  // Schema version
  document: Document
  metadata: {
    created: number
    modified: number
    wordCount: number
    checksum: string  // Data integrity check
  }
  embeddings?: {
    chunks: DocumentChunk[]  // For vector store
    model: string
    generated: number
  }
}
```

#### 2.3 Transactional Writes with Validation
- Add checksums to detect corruption early
- Validate data structure before writes
- Keep last-known-good state in memory for rollback

### Tier 3: Export/Import & Cloud Sync (Future Enhancement)

**Goal**: Give users control and enable multi-device workflows.

#### 3.1 Manual Export/Import
- UI to export all data to JSON
- Import from backup files
- Selective restore (conversations only, annotations only, etc.)

#### 3.2 Automatic Cloud Backup
- Optional cloud sync (similar to reMarkable integration)
- Encrypted backups to user's cloud storage
- Conflict resolution for multi-device use

#### 3.3 Vector Store Integration
- Background indexing of conversations and annotations
- Semantic search across all historical chats
- Context retrieval for AI assistant

## Implementation Plan

### Phase 1: Emergency Backup System (Immediate - 1-2 days)
**Branch**: `issue-74-backup-recovery` (current branch)

Files to modify:
- `src/renderer/lib/persistence.ts` - Add backup/recovery logic
- `src/main/ipc.ts` - Add backup file operations
- `src/renderer/components/RecoveryModal.tsx` - New user notification

Changes:
1. Add `exportDatabaseToBackup()` function
2. Modify `deleteDatabase()` to call backup first
3. Add `restoreFromBackup()` function
4. Implement recovery UI modal
5. Add Electron IPC for file-based backups

**Deliverable**: Spec implementation with recovery modal mockup

### Phase 2: Store Isolation (1 week)
Refactor to multiple databases with migration:
1. Create migration utility to split current DB into separate DBs
2. Update all persistence functions to use new DB structure
3. Add automated tests for migration
4. Roll out with version bump to v4

### Phase 3: Enhanced Resilience (2 weeks)
1. Add checksums and validation
2. Implement versioned document format
3. Build export/import UI
4. Add telemetry for recovery events

### Phase 4: Vector Store Foundation (Future)
1. Design vector embedding storage schema
2. Integrate embedding generation (local or API)
3. Build semantic search interface
4. Background indexing pipeline

## Risk Assessment

### Tier 1 (Backup-First) - Low Risk
- **Pros**:
  - Minimal code change
  - Immediate user benefit
  - No schema migration
  - Falls back to current behavior if backup fails
- **Cons**:
  - Still requires DB deletion/recreation
  - Backup may fail if DB severely corrupted
  - Adds complexity to startup path

### Tier 2 (Store Isolation) - Medium Risk
- **Pros**:
  - Better isolation and resilience
  - Natural fit for vector store later
  - Easier to debug and maintain
- **Cons**:
  - Requires migration of existing data
  - More databases = more surface area for bugs
  - Breaking change for users (need careful rollout)

### Tier 3 (Cloud Sync) - High Risk
- **Pros**:
  - Ultimate data safety
  - Multi-device workflows
  - User control via export/import
- **Cons**:
  - Security/privacy concerns (encryption required)
  - Conflict resolution complexity
  - Requires backend infrastructure or cloud integration

## Testing Strategy

### Unit Tests (Not applicable - project has no test suite)

### Manual Testing with Circuit Electron
1. **Corruption simulation**: Manually corrupt IndexedDB using browser DevTools
2. **Recovery flow**: Verify backup is created and recovery modal appears
3. **Data integrity**: Confirm recovered data matches pre-corruption state
4. **Error scenarios**: Test with various corruption types (missing store, version mismatch, quota exceeded)

### Test Cases
Located in `docs/issues/74/test-plan.md`

## Success Metrics

### Immediate (Phase 1)
- Zero data loss in recoverable corruption scenarios
- 100% user awareness when recovery occurs
- Recovery completes within 5 seconds on average

### Long-term (Phase 2+)
- Support 10,000+ stored conversations without performance degradation
- Vector search returns relevant results in <500ms
- Multi-device sync with <1% conflict rate

## Open Questions

1. **Backup storage location**:
   - IndexedDB backup store (limited by quota) vs.
   - File system (`~/.prose/backups/`) via Electron IPC
   - **Decision**: Use file system for durability, IndexedDB for quick recovery

2. **Recovery UX**:
   - Block app startup until user acknowledges?
   - Allow dismissal and continue?
   - **Decision**: Non-blocking notification with option to review details

3. **Vector store technology**:
   - Use existing library (Vector DB, ChromaDB) vs.
   - Custom IndexedDB-based implementation
   - **Decision**: Defer to Phase 4, but design schema to be compatible with standard vector DBs

4. **Backup encryption**:
   - Encrypt backups at rest?
   - Use OS keychain for key management?
   - **Decision**: Phase 3 concern, start with plaintext local backups

## References

- IndexedDB Best Practices: https://web.dev/indexeddb-best-practices/
- Vector Database Design: https://www.pinecone.io/learn/vector-database/
- Dexie.js (alternative IndexedDB wrapper with better error handling): https://dexie.org/
- LevelDB (alternative local storage, used by Electron): https://github.com/Level/level

## Revision History

- 2026-01-18: Initial plan created
