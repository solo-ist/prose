# #1275: reMarkable credentials still reach the renderer

Part of 1.9.1 (epic [#1230](https://github.com/solo-ist/prose/issues/1230)), and the A1 (#1240) follow-up the operator
chose: 1.9.1's notes can say keys never reach the window. Branch `issue-1275-remarkable-credentials` from
`release/v1.9.1` = `84dcc27`. It touches `src/main` and `src/preload`, so it is gated; the operator's go covers merging
it into the release branch.

## Inventory (`84dcc27`)

**The OCR key** (a separate Anthropic key, Settings → Integrations → reMarkable):

- `remarkable:storeApiKey` writes it to `credentialStore`, and `remarkable:clearApiKey` deletes it, along with the
  legacy `~/.prose/.remarkable-anthropic-key` file.
- `remarkable:getApiKey` **returns it to the renderer**. `RemarkableIntegration` only uses it to set
  `hasAnthropicKey`.
- OCR, in `remarkable:sync`, reads the LLM Anthropic key first, then this key.

**The device token:**

- `settings:load` migrates a plaintext token into `credentialStore`, then **injects the stored token into the
  payload**. `settings:save` stores any token it receives.
- `remarkable:register` returns the token to the renderer, which keeps it in settings.
- The renderer passes it back to `remarkable:validate`, `remarkable:sync`, `remarkable:listCloudNotebooks` and
  `remarkable:moveNotebook`. Readers: `RemarkableIntegration`, `NotebookSelectionDialog`, `useRemarkableSync`,
  `useFileList`, `FileListPanel`, `fileListStore.loadCloudNotebooks`.
- With secure storage unavailable, the token is stripped on save, so it never persisted; the renderer kept it for
  the session.

## Design

**`src/main/remarkableCredentials.ts`** is the only reader and writer of both credentials. It uses `credentialStore`
when available, else main's memory for the session (never written), as `llmKeys.ts` does:

- `resolveDeviceToken` / `setDeviceToken` / `clearDeviceToken`;
- `seedDeviceTokenFromDisk(raw)`: a plaintext token secure storage couldn't take stays usable for the session;
- `hasOcrKey` / `setOcrKey` / `clearOcrKey`;
- `resolveOcrKey`: the LLM Anthropic key, else the reMarkable one, else the legacy file, migrated;
- `remarkableForRenderer(remarkable)`: no `deviceToken`, plus the derived `connected` and `hasAnthropicKey`;
- `stripRemarkableSecretsForDisk(remarkable)`: drops `deviceToken` and `connected`.

**IPC:**

- `remarkable:register` stores the token and answers `{ connected: true }`.
- `validate`, `listCloudNotebooks`, `sync(syncDirectory)` and `moveNotebook(hash, parent)` read the token in main.
- `remarkable:getApiKey` becomes `remarkable:ocrKeyStatus` (a boolean).
- `storeApiKey` and `clearApiKey` go through the module.
- `disconnect` clears both credentials.
- `settings:load` returns `remarkableForRenderer`, and both `settings:save` and the load write-backs strip.

**Renderer:**

- `Settings.remarkable` loses `deviceToken` and gains the read-only `connected`, which main fills and strips on save.
- `hasAnthropicKey` comes from main.
- Every token reader moves to `connected`, and the IPC calls drop the token argument.

## Tests

- **vitest** `src/main/remarkableCredentials.test.ts`, with `./credentialStore` mocked:
  - token set, resolve and clear, in both storage modes;
  - seeding from plaintext;
  - OCR key status;
  - `resolveOcrKey` order: the LLM key, then the reMarkable key;
  - the renderer payload and the disk shape never carry either credential.
- **e2e** `e2e/electron.remarkable-credentials.spec.ts`, falsified on a build of `84dcc27`:
  - with a plaintext device token in `settings.json` and a reMarkable OCR key stored, `loadSettings()` carries
    neither, reports `connected: true` and `hasAnthropicKey: true`, and `remarkable:getApiKey` no longer exists;
  - Settings → Integrations shows the device as connected and the OCR key as saved.
- **Baselines:** 66 / 18 / 6.

## Execution log

- **2026-11-09.**
  - **Changes:**
    - `src/main/remarkableCredentials.ts` is the only reader and writer of the device token and the OCR key.
    - The handlers read the token in main.
    - `register` answers `{ connected }`.
    - `getApiKey` became `ocrKeyStatus`.
    - The settings payload carries `connected` and `hasAnthropicKey`.
    - Every renderer token reader moved to `connected`: `RemarkableIntegration`, `NotebookSelectionDialog`,
      `useRemarkableSync`, `useFileList`, `FileListPanel` and `fileListStore`.
  - **Tests:**
    - Unit 363, including `remarkableCredentials.test.ts` (6).
    - `electron.remarkable-credentials.spec.ts` passes. The reMarkable sync, path, llm-keys and settings-account
      specs pass too: 14 in total.
    - Typecheck 66 / 18 / 6.
  - **QA:** item 12 under A1.
