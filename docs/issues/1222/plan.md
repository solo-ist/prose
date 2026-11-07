# #1222 — MAS 1.9.0: hide direct-only surfaces, pick MAS release notes

Issue: https://github.com/solo-ist/prose/issues/1222 · companion (main process, gated): #1223.
Branch `issue-1222-mas-gates` from `main` = `2d41a6d` (tag `v1.9.0`). Renderer only.

## Context

The App Store still serves 1.6.5 (2026-06-27). The 1.9.0 Mac App Store build is the first since, so App Store
users skip 1.7.0–1.8.2. Share, MCP and skill install, Claude Desktop config, reMarkable, the updater and the
sign-in scheme are already gated on `isMasBuild` / `IS_MAS_BUILD`. A read-only audit of `2d41a6d` found these
renderer surfaces still reaching a MAS user:

- Settings → **Account** (only "Account sign-in is not available in the Mac App Store version") and
  **Integrations** ("No integrations are available in this build") are empty tabs.
- **The post-update release notes open for every upgrading MAS user** (consent version is still 1), and
  `1.9.0.md` describes Claude Desktop setup, sharing sign-in and the MCP update prompt.
- `..` at the granted base root accepts a drop that moves the file outside the grant; the rename fails and
  the error is only logged (#1167).
- Leftovers: `UpdateBanner` mounted (inert), `/help` lists "/report-bug — Report a bug on GitHub", the
  recovery dialog's Report Issue opens GitHub, tab rename calls `shareUpdateLocalPath` (main refuses), the
  comment-delete label can mention the shared page, and the onboarding header carries the design canvas's
  "App Store build" caption.

## Change

1. `lib/featureFlags.ts` exports `isMasBuild()` and `MAS_SUPPORT_URL` (the Help menu's MAS URL); the toolbar,
   `/report-bug`, `/help` and the recovery dialog use them.
2. `SettingsDialog`: on MAS no Account and no Integrations tab (triggers and content); the grid takes its column
   count from the visible tabs; a requested hidden tab renders General.
3. Release notes by build: `releaseNotes/notesId.ts` `releaseNotesIds(version, isMas)` → `['1.9.0-mas', '1.9.0']`
   on MAS, `['1.9.0']` otherwise; `App.tsx` tries them in order. `src/main/releaseNotes.ts` already accepts a
   `-suffix` id, so main is unchanged; `release.yml` reads exactly `<ver>.md`, so the GitHub release body is
   untouched. `resources/release-notes/1.9.0-mas.md` is the App Store edition.
4. A vitest guard over `resources/release-notes/`: a notes file that names a direct-only surface needs a `-mas`
   sibling, and no `-mas` file names one.
5. `UpdateBanner` not mounted on MAS; `/help`'s report line reads "Request support" on MAS; `shareUpdateLocalPath`
   and the shared-page delete label behind `isWebPlatformEnabled()`.
6. `..` drop: on MAS the panel probes the parent with `listDirectory(parent, 1)` (as `navigateToParent` does) when
   the shown folder changes; an inaccessible parent takes no drop and shows no drop ring.
7. Onboarding: the "App Store build" caption goes.

## Tests

- `releaseNotes/notesId.test.ts` (ids) and `releaseNotes/notesFiles.test.ts` (the guard).
- `e2e/electron.mas-gates.spec.ts`, skipped unless the built app reports `isMasBuild` (CI builds the direct app):
  no Share item, no Shared toggle, four Settings tabs, onboarding "1 / 5" with no Claude step and no caption, no
  update banner, a seeded 1.6.5 upgrade opens the MAS notes with no direct-only words, `/help` names Request
  support. Run locally after `MAS_BUILD=1 npm run build`; falsified on the merge-base's MAS build.
- Direct build stays green: settings, release-notes, onboarding, explorer, chat specs.

## Execution log

- **2026-11-06, built** (`85d561b` change, `f66cbd8` spec tightening). `typecheck:renderer` 66 (baseline), e2e
  tsc 6 (baseline), unit 166 in 21 files (+7: ids and the editions guard). The guard was falsified both ways: with
  `1.9.0-mas.md` hidden, `1.9.0.md` fails for naming five direct-only lines; with "Sharing works too." appended to
  the MAS file, that file fails.
- **MAS-flagged run** (`MAS_BUILD=1 npm run build` in the worktree): `electron.mas-gates.spec.ts` 3/3 pass. **On the
  merge-base's MAS build all three fail**: the onboarding shows "App Store build", the upgrade opens the shared
  notes (no "Since the last App Store version", with the Claude Desktop, sharing and MCP lines), Settings shows six
  tabs. The first falsification run passed the onboarding case on the base. The caption renders flush against
  "Welcome", so a `\b`-anchored regex never matched it. It is now asserted with `getByText`, and the tabs are located
  by role so the base fails on their content.
- **Direct build restored** (`npm run build`; `env.ts` back to `false`): settings-account, release-notes,
  onboarding, explorer-interactivity, customizable-menus, comment-threading, mas-bookmarks, document-sessions and
  mas-gates: 58 passed, 3 skipped (the MAS file on a direct build).
- Not covered by an automated check: the `..` drop refusal (the parent is reachable outside the sandbox) and the
  `/help` text (no chat-input spec drives slash commands). Both are in the TestFlight script, `docs/qa/v1.9.0-mas.md`.
