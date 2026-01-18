# Database Recovery Test Plan

**Issue**: #74 - Improve Database Recovery Behavior
**Date**: 2026-01-18

## Test Environment Setup

### Prerequisites
1. Build the app: `npm run build`
2. Install Circuit Electron MCP for automated testing
3. Have Chrome DevTools available for manual DB corruption

### Test Data Preparation
Create a test state with:
- 1 draft document with content
- 3 chat conversations with 10+ messages each
- 5 AI annotations on the draft
- Command history with 20+ entries

## Test Scenarios

### Scenario 1: Normal Database Open (Baseline)
**Purpose**: Verify no regression in happy path

**Steps**:
1. Start app with existing valid database
2. Verify draft loads correctly
3. Verify conversations appear in sidebar
4. Verify annotations display on document
5. Open command palette and verify history works

**Expected Result**: All data loads without errors

**Pass/Fail**: ___

---

### Scenario 2: Missing Object Store (Partial Corruption)
**Purpose**: Test recovery when one store is corrupted but others are accessible

**Setup**:
1. Open Chrome DevTools → Application → IndexedDB
2. Manually delete the `annotations` store from `prose-db`
3. Keep other stores intact

**Steps**:
1. Restart app
2. Observe console logs for recovery attempt
3. Check if recovery modal appears
4. Verify draft and conversations are preserved
5. Verify annotations are empty but app functional

**Expected Result**:
- Recovery modal appears with message: "Database partially recovered. Annotations data could not be restored."
- Draft and conversations intact
- Backup file created in `~/.prose/backups/` with timestamp
- No app crash or blank screen

**Pass/Fail**: ___

---

### Scenario 3: Version Mismatch (Schema Evolution)
**Purpose**: Test recovery when user has old schema version

**Setup**:
1. Manually set DB version to 2 using DevTools
2. Remove `command_history` store (simulating old schema)

**Steps**:
1. Start app
2. Observe upgrade process in console
3. Verify new store is created
4. Verify existing data preserved

**Expected Result**:
- Automatic upgrade to v3
- `command_history` store created
- No data loss from v2 stores
- No recovery modal (this is normal upgrade, not corruption)

**Pass/Fail**: ___

---

### Scenario 4: Complete Database Corruption (Nuclear Scenario)
**Purpose**: Test worst-case scenario requiring full DB deletion

**Setup**:
1. Use DevTools to corrupt DB by:
   - Deleting all stores
   - Or setting invalid version number (negative)
   - Or manually corrupting data files (OS-level)

**Steps**:
1. Start app
2. Observe recovery attempt in console
3. Check recovery modal message
4. Verify backup file was created (if possible)
5. Verify app loads with clean state
6. Attempt to restore from backup (manual action)

**Expected Result**:
- Recovery modal appears: "Database was corrupted and reset. A backup was saved to [path]."
- Backup file exists (if any data was readable)
- App loads with blank state
- User can manually import backup via UI

**Pass/Fail**: ___

---

### Scenario 5: Quota Exceeded Error
**Purpose**: Test recovery when storage quota is exceeded

**Setup**:
1. Use DevTools to simulate quota exceeded:
   ```javascript
   // In console:
   await navigator.storage.estimate() // Check current usage
   // Create large data to exceed quota
   ```

**Steps**:
1. Trigger quota error by saving large draft
2. Observe error handling
3. Verify user notification
4. Check if recovery offers to prune old data

**Expected Result**:
- Error modal: "Storage quota exceeded. Please free up space or export old conversations."
- App remains functional (doesn't crash)
- Recovery offers option to delete old conversations
- Critical data (current draft) preserved

**Pass/Fail**: ___

---

### Scenario 6: Recovery with Backup Restore
**Purpose**: Test full backup → corruption → restore flow

**Setup**:
1. Create backup manually or wait for automatic backup
2. Verify backup file exists in `~/.prose/backups/`
3. Corrupt database completely

**Steps**:
1. Start app (triggers recovery)
2. Click "Restore from Backup" in recovery modal
3. Select most recent backup file
4. Verify data is restored

**Expected Result**:
- File picker shows available backups sorted by date
- After restore, all conversations and drafts appear
- Annotations restored (if in backup)
- Success notification: "Backup restored successfully"

**Pass/Fail**: ___

---

### Scenario 7: Multiple Rapid Failures (Infinite Loop Prevention)
**Purpose**: Ensure recovery doesn't loop infinitely if root cause persists

**Setup**:
1. Simulate persistent corruption (e.g., permission denied on DB files)

**Steps**:
1. Start app
2. Observe recovery attempt
3. Verify it only tries once
4. Check that subsequent failures show error instead of retrying

**Expected Result**:
- First failure triggers recovery attempt
- Second failure shows fatal error: "Unable to initialize database. Please check browser storage settings."
- No infinite loop
- App shows error screen with support link

**Pass/Fail**: ___

---

### Scenario 8: Concurrent Tab Scenario (Version Change)
**Purpose**: Test handling of database version changes across tabs

**Setup**:
1. Open app in two browser windows (if web mode)
2. Or simulate with Electron multi-window

**Steps**:
1. Trigger schema upgrade in Tab 1
2. Tab 2 receives `versionchange` event
3. Verify Tab 2 closes connection gracefully
4. Reload Tab 2
5. Verify both tabs work with new version

**Expected Result**:
- Tab 2 shows notification: "Database updated. Please reload."
- After reload, both tabs functional
- No data loss or corruption

**Pass/Fail**: ___

---

### Scenario 9: Backup File Size and Performance
**Purpose**: Test backup performance with large databases

**Setup**:
1. Generate large dataset:
   - 100 conversations with 50 messages each
   - 500 annotations
   - 1000 command history entries

**Steps**:
1. Trigger manual backup via UI
2. Measure backup time
3. Check backup file size
4. Verify compression is applied
5. Test restore performance

**Expected Result**:
- Backup completes in <5 seconds for 100MB of data
- Backup file is compressed (JSON.gz or similar)
- Restore completes in <10 seconds
- No UI freeze during backup/restore

**Pass/Fail**: ___

---

### Scenario 10: Recovery Modal UX Flow
**Purpose**: Test all user interactions with recovery modal

**Steps**:
1. Trigger recovery (any method)
2. Recovery modal appears with options:
   - "View Details" - expands to show what was lost/recovered
   - "Restore from Backup" - opens file picker
   - "Continue Anyway" - dismisses modal
   - "Report Issue" - opens GitHub issue template
3. Test each option

**Expected Result**:
- Modal is non-blocking (can dismiss to use app)
- Details show clear breakdown: "✓ Recovered: Drafts, Conversations" / "✗ Lost: Annotations (2), Command History"
- Restore flow is intuitive
- Report issue pre-fills GitHub issue with recovery log

**Pass/Fail**: ___

---

## Automated Testing with Circuit Electron

### Test Script Outline
```javascript
// Pseudo-code for Circuit Electron test
describe('Database Recovery', () => {
  test('should backup before deletion', async () => {
    // 1. Create test data
    // 2. Corrupt database
    // 3. Restart app
    // 4. Verify backup file exists
    // 5. Verify modal appears
  })

  test('should restore from backup', async () => {
    // 1. Create backup
    // 2. Corrupt DB
    // 3. Trigger restore
    // 4. Verify data matches pre-corruption state
  })
})
```

**Note**: Since project has no test suite, these would be manual test scripts executed via Circuit Electron's interactive mode.

---

## Performance Benchmarks

### Baseline Measurements (Current System)
- Database open time: ___ ms
- Draft load time: ___ ms
- Conversation load time: ___ ms

### Target Measurements (After Implementation)
- Recovery detection: <100ms
- Backup creation: <2s for 10MB database
- Restore from backup: <5s for 10MB database
- Modal display: <500ms after detection

---

## Regression Testing Checklist

After implementing recovery improvements, verify:
- [ ] Normal app startup unchanged for users without corruption
- [ ] Draft auto-save still works
- [ ] Conversation history persists across sessions
- [ ] Annotations save/load correctly
- [ ] Command palette history works
- [ ] No new console errors or warnings
- [ ] Memory usage not significantly increased
- [ ] App bundle size increase <50KB

---

## Edge Cases

### Platform-Specific
- **macOS**: Test with FileVault encryption enabled
- **Windows**: Test with OneDrive backup sync active
- **Linux**: Test with different filesystem permissions

### Browser-Specific (Web Mode)
- **Chrome**: Test with "Clear data on exit" enabled
- **Firefox**: Test with private browsing
- **Safari**: Test with "Prevent cross-site tracking"

### Electron-Specific
- **App Updates**: Test recovery survives app version updates
- **Data Migration**: Test upgrade from v3 to v4 with real user data

---

## Success Criteria

For Phase 1 implementation to be approved:
1. At least 8/10 test scenarios pass
2. No regressions in baseline functionality
3. Recovery modal displays correctly on first occurrence
4. Backup files are created and readable
5. Performance overhead <10% on startup
6. Clear documentation for manual testing

---

## Test Log Template

```
Test Run Date: ___________
Tester: ___________
App Version: ___________
OS: ___________
Build Type: [ ] Dev [ ] Production

Scenario Results:
1. Normal Open: [PASS/FAIL] - Notes: ___
2. Partial Corruption: [PASS/FAIL] - Notes: ___
3. Version Mismatch: [PASS/FAIL] - Notes: ___
4. Complete Corruption: [PASS/FAIL] - Notes: ___
5. Quota Exceeded: [PASS/FAIL] - Notes: ___
6. Backup Restore: [PASS/FAIL] - Notes: ___
7. Multiple Failures: [PASS/FAIL] - Notes: ___
8. Concurrent Tabs: [PASS/FAIL] - Notes: ___
9. Performance: [PASS/FAIL] - Notes: ___
10. Modal UX: [PASS/FAIL] - Notes: ___

Overall Assessment: [APPROVE/NEEDS WORK]
```

---

## Next Steps After Testing

1. **If tests pass**: Merge to main, monitor telemetry
2. **If tests fail**: Document failures, fix issues, re-test
3. **Follow-up**: Plan Phase 2 (store isolation) based on Phase 1 learnings
