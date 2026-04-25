# reMarkable Early Access — QA Checklist

End-to-end manual verification for PR #416 (issue #369). Every step here exercises hardware integration or human judgment that no automation can substitute for. Required to pass before Phase 6 merge.

**Stop condition:** any step failing is a hard stop. File a regression issue (`gh issue create --label remarkable --title "regression: <step>"` with reproduction + expected vs actual). Identify and revert the responsible commit. Re-run the full checklist from step 1 after the fix. Do not declare pass until all sections complete in a single uninterrupted run.

---

## Pre-flight

Run these once at the start. None should fail.

### P1. Build the integration branch

```bash
git checkout issue-369-remarkable-early-access
git pull
npm install
npm run build
```

Expected: build completes with no errors. `out/` populated.

### P2. Enable the feature flag

Edit `~/Library/Application Support/Prose/settings.json` (create if missing). Add or merge:

```json
{
  "featureFlags": { "remarkable": true }
}
```

If you already have other settings, just merge `featureFlags` in alongside.

### P3. Snapshot pre-test state

```bash
cp ~/Library/Application\ Support/Prose/settings.json ~/qa-prose-settings-before.json
ls -la ~/Documents/reMarkable/.remarkable/sync-metadata.json 2>/dev/null && \
  cp ~/Documents/reMarkable/.remarkable/sync-metadata.json ~/qa-sync-metadata-before.json
```

Expected: settings file copied. The metadata file may or may not exist yet — that's fine; we'll capture it later either way.

### P4. Have a real reMarkable device available

Required: a reMarkable tablet (any model, paired or not), with at least:
- 5+ existing notebooks (mix of types if possible — handwritten, PDF annotation, EPUB)
- At least one notebook with multiple pages of handwritten content (for OCR testing)
- Network connection on the tablet so cloud sync can complete

If the device has only 1–2 notebooks, create a few throwaway ones with quick scribbles before starting — Finding 4 (concurrent worker race) needs ≥5 to actually exercise the parallelism.

### P5. Open the dev server terminal AND DevTools

Most reMarkable instrumentation (`[reMarkable] Processing X/N`, `OCR configured: ...`, `Sync finished`, etc.) lives in the **main process**, which logs to the terminal that ran `npm run dev` — NOT to the renderer DevTools. The two artifacts you'll watch:

1. **Dev server terminal / `.dev.log`** — primary signal for sync progress, OCR, save failures.
   ```bash
   tail -f .dev.log | grep -E "\[reMarkable\]|\[OCR\]"
   ```
2. **Renderer DevTools** (View → Toggle Developer Tools, or `Cmd+Opt+I`) — for renderer-side errors and the few renderer logs that exist (`Synced cloud move for notebook ...`, `Eager cloud list fetch failed`, etc.). Keep it open for the whole session to catch any unexpected exceptions.

Many checks in this doc verify behavior via the **UI** (sync spinners, file panel updates, file presence on disk) rather than logs. If a step says "watch DevTools console," interpret it as "watch for renderer errors / specific renderer-emitted strings" — the bulk of `[reMarkable] ...` logs will be in the terminal stream.

---

## Section A — Connection lifecycle

### A1. Fresh device pairing

**Verifies:** core registration flow still works after the integration merge.

1. If a device is already connected: Settings → Integrations → reMarkable → Disconnect. Confirm the dialog.
2. Settings → Integrations → reMarkable → Connect Device.
3. On the tablet, go to Settings → Account → Mobile/Desktop apps and copy the 8-letter code.
4. Paste the code into Prose. Click Connect.

**Pass:**
- Status flips to "Connected" within ~5 seconds.
- Sync directory field becomes editable.
- No errors in the renderer DevTools console.

**Fail diagnostic:**
- "Invalid code" → re-copy the code, watch for case-sensitivity or extra characters.
- Spinner hangs >15s → check network; reMarkable cloud may be slow.
- Crash → check renderer DevTools console for the React stack, and `.dev.log` (or the dev server terminal) for the main-process traceback.

---

## Section B — Initial sync + IPC bridge (Findings 1, 4, 5, 6)

### B1. Single-fire progress events (Finding 5)

**Verifies:** the `remarkableBridge.ts` IPC singleton fires each progress event exactly once, even with both the file panel AND settings panel mounted. With the singleton in place, the file panel updates each notebook's row exactly once when its sync completes — no flicker, no double-flash of the spinner.

1. With settings panel still open from A1, click the file explorer (the panel on the left) so the notebooks view is visible — both panels are now mounted.
2. Settings panel → Sync Now.
3. Watch the file panel as notebooks complete. Each notebook's row should show its spinner appear, then disappear cleanly when its sync finishes — no double-flash or visible re-render churn.

**Pass:**
- Each notebook's per-row sync indicator clears exactly once per notebook.
- No double-flicker, no duplicate row entries appearing/disappearing.
- `.dev.log` shows one `Processing X/N` line per notebook (count via `grep -c "Processing " .dev.log`).

**Fail diagnostic:**
- Visible double-flash on each notebook's spinner clear → the bridge isn't installed; check `src/renderer/main.tsx` has `import './lib/remarkableBridge'` and `useRemarkableSync` imports `subscribeRemarkableProgress` from the bridge (not directly from `window.api`).

### B2. OCR end-to-end + post-processing

**Verifies:** OCR pipeline works end-to-end and `postProcessOCR` cleans output.

1. Wait for the sync to finish. Note the OCR progress messages.
2. From the file explorer notebooks view, double-click a handwritten notebook with multiple pages.
3. Read the rendered markdown.

**Pass:**
- Markdown renders. No raw HTML, no escape sequences leaking through.
- No trailing spaces at end of lines (zoom in or use a monospace inspector).
- No runs of 3+ blank lines anywhere.
- No leading/trailing whitespace in the document.

**Fail diagnostic:**
- Trailing whitespace visible → `postProcessOCR` not applied; check `src/main/remarkable/ocr.ts` line where `pages: result.pages.map(...)` should be wrapping markdown.
- 3+ blank lines → same.

### B3. `markdownPath` preservation (Finding 1) — **CRITICAL**

**Verifies:** the most important data-loss bug is fixed. Skip this and you risk shipping a regression that orphans users' editable copies.

1. Open the same handwritten notebook from B2 in read-only OCR view.
2. In the editor toolbar (or notebook menu), find "Create Editable Version" (or "Open Editable" if one already exists). Click it.
3. The editable `.md` file opens; make a small edit (add a sentence). Save (`Cmd+S`).
4. **Without changing anything else**, on the **reMarkable tablet itself**, open that notebook and add a single stroke to any page. Wait ~30s for the device to sync to cloud (you can force this from the device's status menu).
5. Back in Prose, click Sync Now.
6. After sync completes, find the same notebook in the file explorer. Right-click → "Open Editable" (or use whatever UI affordance exists for the editable copy).

**Pass:**
- The editable file you edited in step 3 opens. Your edit is still there.
- Renderer DevTools console does not show "editable file not found" or similar errors.

**Fail diagnostic:** **STOP IMMEDIATELY.** This is the regression we explicitly fixed. If it failed, the spread of `existingEntry` at `src/main/remarkable/sync.ts` line ~625 is wrong or got dropped somewhere. Do not continue.

Inspect the metadata:
```bash
cat ~/Documents/reMarkable/.remarkable/sync-metadata.json | jq '.notebooks | to_entries | map({id: .key, name: .value.name, markdownPath: .value.markdownPath, hash: .value.hash})'
```
Look for the notebook you edited. If `markdownPath` is `null` or missing, the bug is back.

### B4. OCR-failure suppression (Finding 6)

**Verifies:** OCR doesn't infinitely retry after a failure on a stable hash.

1. Settings → Integrations → reMarkable → API Key. Note your current OCR API key.
2. **Temporarily break OCR.** Easiest path: rename the env var the app reads. With the app closed, edit `~/Library/Application Support/Prose/settings.json` and find the `remarkable.ocrApiKey` (or wherever OCR creds live; check `src/main/remarkable/ocr.ts` for the env var names — `REMARKABLE_OCR_URL` / `REMARKABLE_OCR_API_KEY`). Set the URL to `https://invalid.example.com/ocr` so requests fail fast.
3. Restart Prose.
4. Trigger a sync that includes a notebook needing OCR (edit a page on the device and re-sync, or pick a notebook that hasn't been OCR'd yet).
5. Wait for the sync to finish — OCR will fail for that notebook.
6. Inspect metadata:
   ```bash
   cat ~/Documents/reMarkable/.remarkable/sync-metadata.json | jq '.notebooks | to_entries | map({name: .value.name, ocrPath: .value.ocrPath, ocrAttempt: .value.ocrAttempt}) | map(select(.ocrAttempt != null))'
   ```
   Pass: the failed notebook has an `ocrAttempt` entry with `hash` matching the notebook's current hash.
7. **Trigger another sync without changing anything.**
8. Watch `.dev.log` (or the dev server terminal).

**Pass:**
- The second sync does NOT attempt OCR for the previously-failed notebook. Confirm via:
  ```bash
  grep "extractTextBatched\|<NOTEBOOK NAME>" .dev.log | tail -20
  ```
  No `[OCR] Calling extractTextBatched` line should appear for the failed notebook on the second sync — only `Processing X/N` then a fast-path skip.
- In the file panel, the failed notebook now shows an **AlertTriangle icon (red/destructive tint)** instead of the faint cloud, and its tooltip reads `(OCR failed YYYY-MM-DD — edit on tablet to retry)` rather than `(synced, processing OCR...)`. This is the user-visible surface added so the suppressed state isn't indistinguishable from "still processing".

**Stale-fallback regression check:** repeat the failure flow against a notebook that already has a successful OCR markdown file on disk (e.g., one that succeeded under the real URL before you broke it). The sync log should still show `[OCR] Reusing existing OCR file: <id>/<name>.md` (the user keeps access to old content) — but the metadata MUST also stamp the `ocrAttempt` sentinel and the file-panel row MUST show AlertTriangle with the tooltip suffix `— showing previous transcription; edit on tablet to retry`. If either is missing, the stale fallback is masking failure again (regression of c14f6e5). Verify metadata via:
```bash
jq --arg id "<NOTEBOOK ID>" '.notebooks[$id] | {ocrPath, ocrAttempt, hash}' ~/Documents/reMarkable/.remarkable/sync-metadata.json
```
Both `ocrPath` (stale path) and `ocrAttempt.hash` (== current hash) should be present together.

**Cleanup:** Restore the real OCR URL/API key, restart, sync once to confirm OCR can run again. Edit a page on the device first so the hash changes, then re-sync — OCR should run for that notebook (sentinel cleared by hash change).

**Fail diagnostic:** if OCR fires again on the unchanged notebook, the `ocrAttempt` sentinel isn't being read or written. Check `needsOCR` calc at `sync.ts` line ~566.

### B5. Concurrent worker race + crash atomicity (Finding 4) — **REQUIRES TIMING**

**Verifies:** the mutex prevents lost entries AND the temp-rename pattern prevents file corruption on crash.

**Part 1 — race correctness:**

1. Sync the full account with all notebooks selected (5+ notebooks needed). Let it complete.
2. Inspect:
   ```bash
   cat ~/Documents/reMarkable/.remarkable/sync-metadata.json | jq '.notebooks | length'
   ```
   Pass: count matches the number of synced notebooks.

**Part 2 — crash atomicity (timed):**

This requires hitting the rename window — a random `kill -9` during idle won't actually test it.

1. Open three terminals.
2. **Terminal A** (busy-loop watcher for the .tmp file):
   ```bash
   while true; do
     ls ~/Documents/reMarkable/.remarkable/ 2>/dev/null | grep -E "sync-metadata\.json(\.|$)" || true
     sleep 0.05
   done
   ```
   Leave running. You'll see only `sync-metadata.json` most of the time. When a save happens, you'll briefly also see `sync-metadata.json.<pid>.tmp`.
3. **Terminal B** (PID lookup, from the repo root):
   ```bash
   cat .dev.pid
   ```
   Note the PID.
4. **Terminal C** (kill on standby):
   ```bash
   # Don't run yet. Just stage the command.
   kill -9 <PID-from-B>
   ```
5. In Prose, edit at least 2 pages on the tablet (force a hash change), trigger Sync Now.
6. Watch terminal A. The instant `sync-metadata.json.<pid>.tmp` appears, run the kill in terminal C.

**Pass:**
- After the kill, examine `sync-metadata.json`:
  ```bash
  cat ~/Documents/reMarkable/.remarkable/sync-metadata.json | jq . > /dev/null && echo "valid JSON"
  ```
  Either the pre-write content (no new sync data) OR the post-write content (new sync data) — both are acceptable. Never partial / invalid JSON.
- The `.tmp` file may be left orphaned alongside; that's harmless. Re-running sync overwrites it.

**Fail diagnostic:** if `sync-metadata.json` is partial / invalid, the temp-rename isn't in place; check `saveMetadata` in `src/main/remarkable/sync.ts` for the `await rename(tmpPath, metaPath)` call. If you couldn't observe the `.tmp` file at all, you're not testing the fix — repeat with bigger-content notebooks (more pages) so the write window is longer.

7. Re-launch Prose; verify it loads cleanly with whichever metadata version landed.

---

## Section C — Settings + concurrent panel mounts (Finding 5 again)

### C1. Settings open during sync

**Verifies:** opening the settings panel mid-sync doesn't double-fire IPC events (Bug 5 was specifically about this case).

1. Close settings panel (if open).
2. Trigger Sync Now from the file panel (or a force-sync via the notebooks view).
3. **While sync is running**, open Settings → Integrations → reMarkable.
4. Watch the file panel and the renderer DevTools console.

**Pass:**
- Each notebook's row in the file panel updates exactly once when its sync completes — no double-flicker after the settings panel mounts.
- `.dev.log`'s `Processing X/N` count still equals the synced notebook count (one line per notebook, not two).
- Renderer DevTools shows no errors.

**Fail diagnostic:** visible double-render on notebook rows → bridge wiring is broken; same diagnostic as B1.

---

## Section D — Auto-sync triggers (Finding 7)

### D1. Connect device while on notebooks view

**Verifies:** the deviceToken dep-array fix triggers auto-sync on connect.

1. Disconnect the device (Settings → Disconnect).
2. **Stay on the notebooks view** in the file panel.
3. Re-connect the device (Settings → Connect Device, paste new 8-letter code).
4. Without switching tabs or doing anything else, wait ~5 seconds.

**Pass:**
- Auto-sync fires. The file panel shows the sync indicator activate. `.dev.log` shows `[reMarkable] Starting sync...` followed by `Fetching notebook list...`.

**Fail diagnostic:** if no auto-sync, the `deviceToken` dep is missing from the `useEffect` array in `src/renderer/components/files/FileListPanel.tsx` (~line 458). You'd have to switch tabs and back to trigger sync, which is the bug we fixed.

---

## Section E — Folder move (PR #400 work)

### E1. Move into existing folder

**Verifies:** basic single-level move propagates to cloud.

1. In the file explorer, find a synced notebook's `.md` (the editable copy created in B3, or a fresh one created via "Create Editable Version").
2. Drag it into an existing local folder (or right-click → Move To).
3. Wait ~5 seconds.
4. On the reMarkable device or my.remarkable.com web UI, confirm the notebook now shows under the corresponding cloud folder.

**Pass:**
- Local file moved.
- Cloud notebook moved to matching folder.
- Renderer DevTools console shows `[reMarkable] Synced cloud move for notebook ...` (this one is genuinely renderer-side — see `FileListPanel.tsx`).

### E2. Move into new local folder (auto-creates cloud folder)

**Verifies:** single missing folder is created on cloud.

1. Create a new folder in the local sync directory: right-click → New Folder, name it `qa-test-1`.
2. Move a synced notebook's `.md` into `qa-test-1`.
3. On reMarkable cloud, confirm a folder named `qa-test-1` was created at the root and contains the moved notebook.

**Pass:** folder exists on cloud; notebook is inside it.

### E3. Multi-level new path — **THE FINDING 7-STYLE FIX**

**Verifies:** the multi-level folder bug fix actually works.

1. Create a deeply nested local folder: `qa-test-2/sub/deep` (three levels of new folders, none of which exist on the cloud).
2. Move a synced notebook's `.md` into `qa-test-2/sub/deep`.
3. On reMarkable cloud, browse: should see `qa-test-2/` → `sub/` → `deep/` → notebook.

**Pass:** all three folder levels exist on cloud, properly nested. Notebook is in the deepest one.

**Fail diagnostic:** if any level lands at root instead of nested, the `justCreated` Map isn't being consulted before the metadata lookup. Check `src/renderer/components/files/FileListPanel.tsx` `syncRemarkableCloudMove` callback — the segment loop should check `justCreated.get(accumulated)` before `Object.entries(notebookMetadata.notebooks).find(...)`.

This is a high-priority regression — moving folders incorrectly means the local view diverges from cloud state and users lose track of where their notebooks live.

### E4. Non-reMarkable file move (no-op for cloud)

**Verifies:** the cloud sync code path doesn't touch unrelated files.

1. Create a file outside the reMarkable sync directory (e.g., a regular `.md` somewhere in your editor's recents).
2. Move it.

**Pass:**
- Local move works.
- Renderer DevTools console: NO `[reMarkable] Synced cloud move ...` line for this move (it's the only renderer-emitted reMarkable log on the move path; absence confirms the cloud-side code path was correctly skipped).
- No errors.

---

## Section F — Modifed → modified migration (Finding 3)

### F1. Legacy on-disk cache migration

**Verifies:** the one-shot migration shim works without data loss.

This requires a metadata file with the old `modifed` typo. If you've been using reMarkable in Prose for a while, your existing cache should already have it. Check:

```bash
cat ~/Documents/reMarkable/.remarkable/sync-metadata.json | jq '[.. | objects | select(.modifed != null)] | length'
```

- If output is `0`: you have no legacy entries to migrate. Either skip this step OR fabricate one for testing:
  ```bash
  # Make a backup first
  cp ~/Documents/reMarkable/.remarkable/sync-metadata.json ~/sync-metadata-backup.json
  # Edit sync-metadata.json by hand: in any pageOCRCache entry, rename "modified" to "modifed"
  # (or use jq to rewrite a single one)
  ```

1. Restart Prose. The first sync after restart triggers `loadMetadata`, which runs the migration.
2. After Prose loads, **without manually triggering anything**, inspect:
   ```bash
   cat ~/Documents/reMarkable/.remarkable/sync-metadata.json | jq '[.. | objects | select(.modifed != null)] | length'
   ```

**Pass:**
- Output is `0`. No `modifed` entries remain.
- Sample any `pageOCRCache` entry — it should now have `modified` (with the same value).
- Trigger a sync. In `.dev.log`, pages with cached OCR should hit the timestamp-match cache (`[OCR] Cache hit for page ... (timestamp match)`), NOT re-OCR. Confirm via `grep "Cache hit\|Calling extractTextBatched" .dev.log | tail -20`.

**Fail diagnostic:** if `modifed` entries persist, the migration didn't write back. Check `loadMetadata` in `sync.ts` for the `if (migrated) await saveMetadata(...)` line.

If the cache misses fire (re-OCR every page), the comparison in `cached.modified === currentTimestamp` was broken by the rename — check that the sync.ts read at line ~285 was renamed correctly.

---

## Section G — Disconnect / reconnect cycle

### G1. Full disconnect

**Verifies:** disconnect doesn't leak state or corrupt metadata.

1. Settings → Integrations → reMarkable → Disconnect. Confirm.

**Pass:**
- Status: disconnected.
- Renderer DevTools console: no errors.
- `~/Documents/reMarkable/.remarkable/` directory removed (or emptied; check `purgeSync` behavior).
- User-visible markdown files (the editable copies in `~/Documents/reMarkable/`) are NOT deleted.

```bash
ls ~/Documents/reMarkable/                    # should still see your editable .md files
ls ~/Documents/reMarkable/.remarkable/ 2>&1   # should be "No such file or directory" or empty
```

### G2. Reconnect with same device

1. Re-pair using a fresh code (Settings → Connect Device).
2. Sync Now.

**Pass:**
- All notebooks re-list on the cloud side (you may need to re-select which to sync).
- Editable copies you preserved get re-linked (markdownPath populated again on first OCR/download — though this depends on findNotebookByFilePath finding them by filename match).

---

## Section H — HMR teardown (Finding 5 dev path)

### H1. Hot-reload doesn't stack listeners

**Verifies:** `import.meta.hot.dispose` in the bridge tears down properly.

Only relevant if you're running `npm run dev` (which you should be for this whole session).

1. Open `src/renderer/lib/remarkableBridge.ts` in your editor.
2. Add a trivial whitespace change (e.g., add a blank line at the end). Save.
3. Vite should hot-reload the module — Prose's window may flash briefly, no full restart.
4. In renderer DevTools console, check that the page didn't error.
5. Trigger Sync Now.
6. Watch the file panel as notebooks complete.

**Pass:**
- Each notebook's per-row sync indicator clears exactly once per notebook (same as B1) — HMR didn't stack a second listener.
- No "duplicate event" or "listener already registered" warnings in renderer DevTools.
- `.dev.log` shows one `Processing X/N` line per notebook, matching the synced count.

**Fail diagnostic:** if you see double-flash on each notebook's spinner clear after HMR, `import.meta.hot.dispose` isn't firing. Check that the bridge's HMR teardown clears both `unsubscribeIpc` and `listeners`.

---

## Section I — View-only enforcement (regression check)

### I1. Read-only notebook is not editable

**Verifies:** existing view-only enforcement (PR #320) still works after merge.

1. Open a notebook's read-only OCR view (the `.md` shown in the read-only `.remarkable/` hidden dir, NOT the editable copy).
2. Try to type. Try `Cmd+V` to paste.

**Pass:**
- No characters appear. No paste happens.
- Toolbar shows read-only indicator.
- An "Open Editable" affordance is visible.

---

## Final checklist — post-QA report

When all sections A–I pass in a single uninterrupted run, post a comment on PR #416 in this format:

```markdown
## QA Report — PR #416 manual verification (YYYY-MM-DD)

Ran the full checklist at docs/issues/369/qa-checklist.md against:
- Branch: issue-369-remarkable-early-access @ <commit sha>
- Device: reMarkable <model>, <N> notebooks
- macOS: <version>

| Section | Result |
|---|---|
| A. Connection | ✅ |
| B. Initial sync + IPC bridge | ✅ |
| C. Settings during sync | ✅ |
| D. Auto-sync triggers | ✅ |
| E. Folder moves | ✅ |
| F. modifed migration | ✅ |
| G. Disconnect/reconnect | ✅ |
| H. HMR teardown | ✅ |
| I. View-only | ✅ |

No regressions observed. Approved for Phase 6 merge.
```

If any section failed, post the regression issue link instead and stop. Do NOT proceed to Phase 6.

---

## Cleanup

After QA (pass or fail):
- Restore real OCR URL/API key in settings if you broke them in B4.
- Delete `qa-test-1`, `qa-test-2/` etc. test folders from the sync directory and from the cloud (my.remarkable.com).
- Delete the QA notebooks you created on the device if they're junk.
- Remove `~/qa-prose-settings-before.json` and `~/qa-sync-metadata-before.json` snapshots.
- Optionally turn the feature flag back off if you want to verify default-off behavior independently.
