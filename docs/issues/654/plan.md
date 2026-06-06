# #654 — MAS bookmark architecture: base-root preservation + in-session activation

## Root-cause chain (verified against `main` @ v1.6.2)

1. **Persistent base-root bookmark loss (the headline bug).**
   `projectsStore.addProjectFromPicker` (≈L142) and `switchToProject` (≈L205) sync the
   project's bookmark into the legacy single slot `settings.masDirectoryBookmark` — but
   that slot originally held the **base root's** (defaultSaveDirectory's) bookmark, which
   is stored nowhere else. The overwrite persists to disk: after relaunch the base root
   has no bookmark anywhere → its listing fails silently until the user re-picks it.
2. **In-session base-root loss.** `file:selectFolder` (ipc.ts ≈L282) stops the live
   base-root claim (`stopAccessingBookmark`) on *any* folder pick — so adding a
   project/favorite revokes base-root access immediately, before any relaunch.
3. **No in-session activation path** (original issue body): bookmarks added after launch
   are never registered into the per-id stop-fn maps (`projectBookmarkStopFns`) until the
   next launch; the only in-session claim lives in the single slot, where (2) tramples it.

Context that narrows the original issue body: the #651 restore loop already activates
every `projects[]`/`favorites[]` bookmark at startup, and Powerbox grants session access
to freshly picked folders — so the *switch* path mostly worked in-session. The damage was
the slot overwrite (1) + the claim clobber (2).

## Fix (per Angel's 2026-06-04 comment on #654)

- **`masDirectoryBookmark` belongs exclusively to the base root.**
  Remove both sync blocks in `projectsStore`. Startup activation of project/favorite
  bookmarks is owned by the settings:load restore loops.
- **`file:activateBookmark` IPC** (`src/main/ipc.ts`): activates a project/favorite
  bookmark on demand (MAS-gated; non-MAS returns success no-op), releasing any prior
  claim for that id and registering the stop-fn in the per-id map so the existing
  settings:save reconciliation manages its lifecycle. Exposed via preload + ElectronAPI
  (optional member) + browserApi no-op. Called from `addProjectFromPicker`,
  `addFavoriteFromPicker`, and `switchToProject`.
- **Stop the selectFolder clobber**: picks activate into an ephemeral claims list held
  for the process lifetime; `stopAccessingBookmark` is only managed by settings:load.
- **UX guard (the "+UX guard" in the title)**: on MAS, switching to a project with no
  stored bookmark (or a failed activation) raises a toast (notificationStore) telling the
  user to remove + re-add the project to re-grant access — instead of silent file-op failure.
- **Healing migration** (`settingsStore.migrateOnDiskSettings`): users on v1.6.0–v1.6.2
  have a poisoned slot (`masDirectoryBookmark` === some project/favorite bookmark) and
  their true base-root bookmark is unrecoverable. Detect by bookmark equality, clear
  `masDirectoryBookmark` + `defaultSaveDirectory` → the existing folder-picker empty
  state takes over and the next explicit pick re-establishes both. Persisted via the
  existing migration write-back branch (condition extended to bookmark changes).

## Out of scope

- Startup explorer-root/activeProjectId reconciliation: session restore (IndexedDB
  drafts) already reinstates `rootPath` + `viewMode`; the pre-#669 mismatch scenario no
  longer reproduces. Revisit only if QA shows a no-session-draft edge.
- Multi-slot redesign of the base-root bookmark (arrays) — unnecessary once the slot's
  ownership is exclusive.

## Verification

- **e2e (deterministic, isolated `PROSE_USER_DATA_DIR`)** — `e2e/electron.mas-bookmarks.spec.ts`:
  1. *Heal*: seed `masDirectoryBookmark` identical to `projects[0].bookmark` → launch →
     poll settings.json until both `masDirectoryBookmark` and `defaultSaveDirectory` are
     cleared.
  2. *No-clobber (negative control vs `main`)*: seed distinct base bookmark + project
     bookmark → switch project via the Projects panel UI → assert settings.json still
     holds the base bookmark. Fails on current `main` (sync block overwrites it).
- **MAS sandbox behavior** (`startAccessingSecurityScopedResource` semantics) is not
  testable on the desktop build: verified on TestFlight build 30 (or locally via masDev
  once #487's provisioning steps land).
