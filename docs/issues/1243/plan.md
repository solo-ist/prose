# #1243 — W1: import the App Store edition's data into the direct build

Part of the 1.9.1 epic (#1230, track W: the App Store wind-down, **importer only**). Security-gated
(`src/main`, `src/preload`): the operator merges.

## Context

The App Store edition is being retired. Before any farewell notice sends people to the direct download,
the direct build has to bring their data across: otherwise a switching user lands on a blank, un-onboarded
app with none of their projects, open tabs, AI history or comments. Both editions share the bundle id
`ist.solo.prose`; the App Store edition's profile lives in its sandbox container, which the unsandboxed
direct build can read (the operator's MacBook run settles how macOS treats the store re-signature).

## Inventory: the profile, item by item

Read from `src/main` (`getSettingsDir()` / `app.getPath('userData')` consumers) and a real direct profile.

| Item | What it holds | Import? |
|---|---|---|
| `settings.json` | every setting: projects, favorites, recent files (`recentFiles`), `defaultSaveDirectory`, consent, appearance, editor prefs | **yes**, transformed (below) |
| `IndexedDB/` | the renderer's `prose-db` (tab drafts and session, conversations, annotations, comments, suggestions, summaries, emoji cache, command history; blobs in its sibling `.blob` dir) | **yes** |
| `Local Storage/` | renderer localStorage (small; a few viewer keys) | **yes** (harmless, same format) |
| `dictionary.json`, `Custom Dictionary.txt` | personal dictionary (Prose's and Chromium's) | **yes** |
| `dialog-dirs.json` | last folder per dialog (#1153) | **yes** |
| `migration-v2.done` | the legacy `~/.prose` migration sentinel | **yes** (keeps `migrateFromLegacyDir` a no-op) |
| `credentials/llm-api-key` | the API key, `safeStorage`-encrypted | **staged only**, never into this profile's `credentials/` (below) |
| `credentials/*` (others), `share-sync.json` | reMarkable and sharing state: forced off / compiled out on the App Store edition | no |
| `mcp-auth-token`, `prose.sock`, `mcp-server/` | per-launch MCP secret, socket, installed bridge | **never** |
| `SingletonLock`/`Socket`/`Cookie` | the running instance's lock | **never** |
| `Cache`, `Code Cache`, `GPUCache`, `Dawn*`, `Graphite*`, `GPUPersistentCache`, `Shared Dictionary`, `blob_storage`, `Crashpad`, `sentry` | caches and crash state | no |
| `Preferences`, `Local State`, `Cookies`, `Session Storage`, `WebStorage`, `Network Persistent State`, `TransportSecurity`, `Trust Tokens`, `DIPS`, `SharedStorage`, `Extension State`, `declarative_performance_observer.db`, `migration.log` | Chromium per-install state | no |

An **allowlist**, not a denylist: anything not named in the first five rows is left behind.

`settings.json` is transformed on the way in: `masDirectoryBookmark` and each project's and favorite's
`bookmark` are dropped (security-scoped bookmarks mean nothing outside the sandbox); `llm.apiKey` and
`remarkable.deviceToken` are blanked; `lastSeenVersion` is set to the running version, so the post-update
notes modal does not stack on the import summary. Recent files whose path lies inside the App Store
container are listed in the summary (they are files only that edition can see), not rewritten.

## Mechanism

**Copy at startup, before anything opens the profile.** LevelDB must not be copied or replaced while open,
and the renderer's IndexedDB is open the whole time the app runs. So the renderer only *asks*:

1. `appStoreImport:start` checks that the App Store edition is not running (its `SingletonLock` symlink
   names a live pid → refuse: "Quit the App Store edition first"), writes
   `app-store-import.pending.json` into this profile, then `app.relaunch()` + `app.quit()`.
2. The next launch, right after `requestSingleInstanceLock()` succeeds and before `whenReady`, runs
   `runPendingImport()` synchronously: copy every allowlisted item into a staging folder inside this
   profile; only when all copies succeeded, move each replaced item into
   `before-app-store-import-<timestamp>/` (a backup) and rename the staged item into place. A failure
   before the swap changes nothing. The pending marker expires after 10 minutes (a quit the user cancelled
   must not import days later). The result (what was copied, skipped, backed up, staged) is written to
   `app-store-import.json` and logged.

This is the dev-profile seed's pattern (`seedDevProfile`, `paths.ts`): synchronous, at the top of main,
built aside and renamed in. Running it after the single-instance lock means a second instance launched
mid-import can never touch the live profile. A native pre-window dialog on first launch would avoid one
relaunch, but needs a second mechanism for the Settings button and cannot be driven by the e2e suite; one
mechanism covers both.

**Copy, never move.** The App Store container is only read.

**Replace with a backup, one mode.** The import replaces this profile's allowlisted items and keeps the
replaced ones in the backup folder. On the automatic first-launch offer there is nothing meaningful to
replace; from Settings the confirmation says so plainly. (Merging two LevelDB stores is not possible from
main; merging the settings lists alone would leave tabs and records behind and is a follow-up if wanted.)

## API keys: no silent keychain prompt

The key file is staged into `app-store-import/credentials/`, never into `credentials/`: a copied blob there
would be decrypted by `settings:load` on the next launch, and that decrypt can raise a keychain prompt
("Prose wants to use … 'Prose Safe Storage'") the user never asked for, or fail because the App Store and
Developer ID signatures read different items. After the import, the summary asks: **Bring my key over**
(macOS may ask for keychain access; explained in the dialog) or **I'll enter it again**. Bring over →
`appStoreImport:importKeys` decrypts the staged blob with `safeStorage`; a value that decrypts to printable
text is stored with `credentialStore.set`; anything else is reported and the user is sent to
Settings → LLM. The staged copy is deleted either way. Skipped when this profile already has a key.

## When it is offered

- **Available** = not an App Store build, a packaged app (or the e2e seam) and
  `~/Library/Containers/ist.solo.prose` exists. Only that directory entry is checked until the user agrees;
  nothing inside the container is read before then (so no "access data from other apps" prompt at launch).
- **Offered automatically** when available, this profile is fresh (no `settings.json`, or no `aiConsent`),
  and no earlier decision is recorded. The offer opens before onboarding; onboarding waits for the answer.
  **Not now** is recorded and the offer never returns on its own.
- **Settings → General → "Import from the App Store edition"** whenever available, behind a confirmation.
- After an import, a one-time summary: what came over, the key step, and any recent files that live inside
  the App Store container. It waits for onboarding to close if consent is still due.
- The renderer refuses to start while a tab has unsaved changes (they would be lost to the replace).

## Files

| File | Change |
|---|---|
| `src/main/appStoreImport.ts` | New, no `electron` import: the allowlist, `transformSettings`, `runPendingImport`, status, staging, the running check, `importStagedKeys(decrypt, store)` |
| `src/main/appStoreImportIpc.ts` | New: `appStoreImport:status`, `:start`, `:decline`, `:acknowledge`, `:importKeys` (MAS: every handler reports unavailable) |
| `src/main/index.ts` | `runPendingImport` after the single-instance lock; handlers registered beside the file watcher's |
| `src/preload/index.ts`, `src/renderer/types/index.ts` | `appStoreImport` group (optional in `ElectronAPI`) |
| `src/renderer/components/appStoreImport/AppStoreImportDialogs.tsx` | New: offer, confirmation, summary + key step |
| `src/renderer/components/layout/App.tsx` | Offer before onboarding; summary after it |
| `src/renderer/components/settings/SettingsDialog.tsx` | General: the import row |
| `src/main/appStoreImport.test.ts`, `e2e/electron.app-store-import.spec.ts` | Tests |
| `docs/qa/v1.9.1.md` | QA block W1 |
| `CLAUDE.md` | The `appStoreImport:*` IPC namespace |

Test seams (honoured only with `PROSE_USER_DATA_DIR`, the existing e2e isolation): `PROSE_APP_STORE_DATA_DIR`
points at a fake App Store profile (without it, test runs never see the real container, so a developer Mac
with the App Store edition installed cannot change other specs' first-run flow); `PROSE_IMPORT_RELAUNCH=0`
quits without relaunching.

## Tests

- **vitest** (`appStoreImport.test.ts`, real temp dirs): allowlisted items copied, everything else left
  (`mcp-auth-token`, `prose.sock`, `SingletonLock`, caches, `mcp-server/`, other credentials); the key
  staged, never in `credentials/`; settings transformed; replaced items backed up; a failed copy changes
  nothing; expired or absent marker → no-op; a running App Store edition → nothing copied; status
  (fresh / not fresh / declined / imported); `importStagedKeys` (decrypt ok → stored; decrypt throws or
  non-printable → failed; staged copy removed).
- **e2e** (`electron.app-store-import.spec.ts`, port 9243): a fake App Store profile made by launching the
  app once on its own profile and leaving an untitled tab with text; then a fresh profile with the seam:
  the offer appears before onboarding; Not now → recorded, onboarding opens, no offer after a relaunch;
  Import → the pending marker is written and the app quits; a launch with the marker → the project, the
  tab text and the summary are there, onboarding is skipped, no key in `credentials/`, the staged key
  offered. Falsified on a build of the merge-base.
- **The real check** (the operator's MacBook, App Store 1.9.0 installed): see `docs/qa/v1.9.1.md` § W1.
