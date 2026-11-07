# #1240 — A1: provider layer and one key per provider in main

Part of the 1.9.1 epic [#1230](https://github.com/solo-ist/prose/issues/1230) (track A, Prose Agents on your key).
Security-gated (`src/main`, `src/preload`): CI + claude review, then the operator merges. Branch
`issue-1240-provider-layer` from `main` = `84ba7bd`.

## Context

Prose Agents get OpenAI (A2, #1241) and Inference Coop (A3, #956) next. Before a second provider can exist, the app
needs one place that says what a provider is, and one way a key is stored and read. Today the Anthropic key is
decrypted in main, **handed to the renderer inside the settings payload**, held in the settings store, and **sent
back to main on every request** (`llm:stream`, `llm:chat`, `settings:testApiKey`, `llm:fetchModels`). A1 keeps every
key in main: the renderer learns only whether a key is set (and its last four characters, for the "Key saved"
line), and main reads the key for the provider each request names. No new provider; behaviour unchanged.

## Inventory (`84ba7bd`)

| Where | What it does with the key today |
|---|---|
| `src/main/ipc.ts` `settings:load` | Migrates a plaintext `llm.apiKey` from `settings.json` into `credentialStore` (when available), then **injects the stored key into the payload** returned to the renderer |
| `settings:save` | Stores `settings.llm.apiKey` (when non-empty and secure storage is available), writes `apiKey: ''` to disk; with secure storage unavailable, strips it and stores nothing |
| `settings:testApiKey`, `llm:fetchModels` | Take `{ provider, apiKey }` from the renderer |
| `llm:chat`, `llm:stream` | Take `request.apiKey` from the renderer |
| `emoji:generate` | Reads plaintext `settings.json` first, then `credentialStore` |
| reMarkable OCR (`remarkable:sync`) | `credentialStore` LLM key, else plaintext `settings.json`, else the reMarkable-specific key |
| Renderer | `settingsStore` (defaults, the model fetch on load), `lib/llm.ts` (`validateConfig` / `aiAvailability` read `llm.apiKey`), `SettingsDialog` (the key field binds `llm.apiKey`; Save persists), `OnboardingDialog` (tests, then `setLLMConfig({ apiKey })` + save), `useChat` ×2 and `summaryStore` (send it), `RemarkableIntegration` (`hasAnthropicLLMKey`) |
| Web | `lib/browserApi.ts` (the old browser fallback: localStorage settings, calls Anthropic from the browser, CORS-blocked), `mocks/webApi.ts` (web mode: LLM stubbed) |

**Secure storage unavailable** (Linux without a keyring, which is also CI): `settings:load` returns a plaintext key
found in `settings.json` to the renderer and every path uses it; the first `settings:save` strips it from disk, but
the renderer keeps it for the session. A typed key works for the session and is never written. CLAUDE.md's "keys are
stripped, not saved" describes the write side only. **A1 keeps exactly this**: main keeps such a key in memory for
the session (seeded from a plaintext key at load, or set by the user), never writes it, and reports it as not
persisted.

Not touched (noted for later): `remarkable:getApiKey` returns the reMarkable-specific Anthropic key to the renderer,
and the reMarkable device token still rides the settings payload. Both are outside the LLM provider layer.

## Design

**`src/shared/llm/providers.ts`** (new): `LLMProvider = 'anthropic'`; `ProviderInfo { id, label, transport:
'anthropic', baseURL, credentialKey, models (static seed), modelsSource: 'live+static', defaultModel, smallModel,
thinking, keyFormat? }`; `PROVIDERS`, `PROVIDER_IDS`, `getProvider`, `isProvider`; `LLMKeyStatus { hint: string;
persisted: boolean }` and `LLMKeyStatusMap = Partial<Record<LLMProvider, LLMKeyStatus>>`. The Anthropic model seed
moves here; `models.ts` re-exports it and its `getModelsForProvider`, `getDefaultModel`, `getDefaultHaikuModel`
(now `getSmallModel(provider)`, the old name kept as the Anthropic alias) and `resolveModelName` read the entry.
The Anthropic credential key stays `llm-api-key`, so stored keys keep working.

**`src/main/llmKeys.ts`** (new, the only reader and writer of LLM keys):
- `resolveProviderKey(provider)`: `credentialStore` → the session map. Never the renderer.
- `seedFromDisk(raw)`: at `settings:load`, a plaintext `llm.apiKey` not already in `credentialStore` goes into the
  session map (the migration into `credentialStore` stays where it is, before it).
- `setProviderKey(provider, key)`: `credentialStore` when available (persisted), else the session map.
- `clearProviderKey(provider)`: both.
- `keyStatusAll()`: `{ [provider]: { hint: last four, persisted } }` for providers with a key.
- `toRendererSettings(raw, status)`: the payload with `llm.apiKey` removed and `llm.keyStatus` attached.
- `stripLlmSecretsForDisk(settings)`: `llm` without `apiKey` / `keyStatus` (the existing `stripSecretsForDisk`
  calls it).

**IPC** (`ipc.ts`, preload): new `llm:keyStatus`, `llm:setKey` `{ provider, key }` (validated: a known provider, a
non-empty string under 4 KB), `llm:clearKey` `provider`, each returning the status map. `settings:load` returns
`toRendererSettings`; `settings:save` strips and **never stores a key** (keys have one door). `llm:stream`,
`llm:chat`, `emoji:generate`, `llm:fetchModels` and `settings:testApiKey` resolve the key in main for the request's
provider (`testApiKey` and `fetchModels` still accept a freshly typed key, so a key is verified before it is
saved). reMarkable OCR reads `resolveProviderKey('anthropic')`, then its own key as today.

**Renderer:** `Settings.llm` loses `apiKey` and gains the read-only `keyStatus` (filled by main, stripped on save);
`LLMRequest` loses `apiKey`; `TestApiKeyRequest.apiKey` and the `fetchModels` key become optional. `lib/llm.ts`
gains `hasProviderKey(llm)`; `validateConfig` / `aiAvailability` read it. `settingsStore` gains `setLlmKey` /
`clearLlmKey` (which update `keyStatus` from main's answer). Settings → LLM: with a key saved, the field shows "Key
saved ••••••••abcd" with **Test**, **Replace** and **Clear**; typing a key shows the input with Test, and **Save
Changes** stores it (the dialog's existing semantics). Onboarding verifies the typed key, then stores it through
`setLlmKey`. `browserApi` keeps its key in localStorage under its own entry (the same exposure it had inside the
settings object); `webApi` stubs the three calls.

## Tests

- vitest `src/main/llmKeys.test.ts` (`./credentialStore` mocked): resolution order; set persists when available and
  stays in memory when not; clear removes both; seeding from a plaintext key; status hints; `toRendererSettings` and
  `stripLlmSecretsForDisk` never contain the key.
- vitest `src/shared/llm/providers.test.ts`: the model helpers read the entry.
- e2e `e2e/electron.llm-keys.spec.ts` (port 9241), falsified on the merge-base build:
  1. a plaintext key seeded in `settings.json` never reaches the renderer: `loadSettings()` carries no key and a
     `keyStatus` hint;
  2. a chat turn's `llm:stream` request carries no key (the handler stubbed to record the request);
  3. Settings → LLM shows "Key saved", Clear empties the status, a typed key + Save Changes stores it, and the
     payload still carries no key.
- Must stay green: onboarding, settings-account, document-sessions (the chat cases seed a plaintext key),
  ai-provenance, ai-edit-lifecycle, screenshot-chat, web.chat-llm.
- Baselines: `typecheck:renderer` 69, `tsc -p tsconfig.node.json` 24, `typecheck:e2e` 6.

## Execution log

- **2026-11-07.** `48ca3eb` plan · `3fe1ced` the change + tests · `8caffeb` CLAUDE.md + QA block A1
  (`docs/qa/v1.9.1.md`). `typecheck:renderer` 69 = base (same error set); `tsc -p tsconfig.node.json` 23 (base 24);
  unit 176 passed; `electron.llm-keys.spec.ts` 3/3 on the branch, **3/3 failing on a build of `84ba7bd`**; related
  specs green (onboarding and document-sessions cases 11/12 from temporary copies on spare debug ports).
  PR [#1247](https://github.com/solo-ist/prose/pull/1247). CI e2e green on the first run.
- **Review 1** (issues-found, none blocking) → the follow-up commit:
  - `clearProviderKey`'s unguarded `credentialStore.delete` is deliberate (it only unlinks, never throws, and must
    remove a key saved while secure storage was available): documented, tested, and the IPC handler and the
    store actions now catch;
  - the `getProvider` fallback is documented as display-only (it keeps a newer build's settings rendering), with
    every key-using path gated by `isProvider`; `emoji:generate` now gates too;
  - `llm:setKey` reads the status once.
  Unit 177 passed; the key and settings-account specs 8 passed.
- **Review 2** (issues-found): `testApiKey` and `fetchModels` switch on the transport with no `default`; a second
  transport would have fallen through to `undefined`. Both now end in an exhaustive `never` default (checked: widening
  `ProviderTransport` fails to compile at both). `browserApi.setLlmKey` takes main's 4096-character ceiling.
- **Review 3** (issues-found, none blocking): `llm:chat`, `llm:stream` and `emoji:generate` also speak Anthropic
  whatever the transport, so each now refuses a non-Anthropic transport through the same `never` check (widening
  `ProviderTransport` fails to compile at all five sites); `llm:stream` returns early for an unknown provider; the
  `llm:clearKey` comment names the invariant (the plaintext `llm.apiKey` field only ever held the Anthropic key).
