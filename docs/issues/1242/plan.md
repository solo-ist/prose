# #1242 — A4: provider settings, onboarding, models by provider

Part of the 1.9.1 epic [#1230](https://github.com/solo-ist/prose/issues/1230), track A. Branch
`issue-1242-provider-settings` from `release/v1.9.1` = `18b2ab6` (A1 #1247, A2 #1260, W1 #1248, M4, P4 in). The PR
targets `release/v1.9.1`. Expected renderer + shared only (not gated).

## Context

A1 kept keys in main, one per provider; A2 added OpenAI over Chat Completions with the minimum UI (a Provider select
and the one key field of the active provider). A4 is the user-facing half: every provider's key visible and
manageable at once, models listed for the provider in use everywhere a model is picked, onboarding that lets a new
writer start on either provider, and Prose Agent records that read well for OpenAI models.

## Inventory (`18b2ab6`)

- **Settings → LLM** (`SettingsDialog.tsx`): an Enable AI switch; a Provider select (A2); the Model select from
  `fetchedModels` or the seed; one key block for the **active** provider (saved line with Test / Replace / Clear, or
  an input, stored on Save Changes); the Emoji switch (Anthropic key only). Switching provider resets the model to
  the provider default; the other provider's key is kept in main but not shown.
- **Models:** `settingsStore.fetchedModels` is untagged (A2 clears it on a provider switch). The **status bar** model
  menu and `ModelPickerDialog` list `getModelsForProvider(provider)`, the static seed only, never the live list.
- **Onboarding** (`OnboardingDialog.tsx`, `steps.ts`): the key step is Anthropic-only ("Add your Anthropic key",
  `sk-ant-`, console.anthropic.com, "Checking with Anthropic…"); the AI step says content goes "to Anthropic"; the
  summary says "On · key in Keychain".
- **Records:** `useChat` stamps `actor: { kind: 'prose-agent', provider: llm.provider, model }` (P1); `actorLabel`
  shows `Prose · ${shortModelName(model)}`, and `shortModelName` leaves non-Claude ids as given (`gpt-5-mini`).
- **reMarkable** (`RemarkableIntegration.tsx`): `hasAnthropicLLMKey` also requires the active provider to be
  Anthropic, so with OpenAI active it asks for a separate key even though main's OCR uses the saved Anthropic key.
- MAS: the LLM tab ships in the App Store build; nothing here is direct-only.

## Design

- **Settings → LLM:** *Provider* (the active one) and *Model* stay at the top. Below them, **API keys**: one row per
  provider in `PROVIDERS`, each with its own state (Key saved ••••xxxx, "this session only" when not persisted, or
  No key) and its own actions (Test, Replace or Add key, Clear), a draft input per provider while adding or
  replacing, and its own test result. Save Changes stores every valid draft. Switching the active provider never
  touches a key, and every row stays visible, so the other provider's key is visibly kept.
- **Model per provider:** `settings.llm.modelByProvider` remembers the last model used with each provider; switching
  back restores it (else the provider's default).
- **Models by provider, everywhere:** `fetchedModels` is tagged with its provider (`fetchedModelsProvider`); one
  hook, `useAvailableModels()`, returns the live list for the active provider, else its seed. Settings, the status
  bar and `ModelPickerDialog` all read it; the store fetches the live list at load, after a key is saved for the
  active provider, and on a provider switch.
- **Onboarding:** the key step opens with a provider choice (Anthropic, the default, or OpenAI), then the key for
  that provider: its title, prefix hint, key-console link and "Checking with …" follow the choice; Verify tests and
  stores the key through main and makes that provider active (with its default model). Still skippable. The AI step
  and the Done summary name the provider ("On · OpenAI key in Keychain"). `keysUrl` joins the provider entry.
- **Labels:** `shortModelName` also compacts OpenAI ids: `gpt-5-mini` → "GPT-5 mini" (date suffix dropped); other
  ids stay as given. So an OpenAI turn reads "Prose · GPT-5" in the popover, Activity and the tooltips.
- **Anthropic-only surfaces keep saying so:** the emoji switch (A2), and reMarkable now counts the saved Anthropic
  key whatever provider is active, with copy saying OCR uses the Anthropic key.

## Tests

- vitest: `shortModelName` for OpenAI ids; `summaryRows` with the provider; `useAvailableModels`' choice rule (as a
  pure function).
- e2e `e2e/electron.provider-settings.spec.ts` (port 9244, OpenAI stubbed in main as in A2), falsified on a build of
  `18b2ab6`: (1) both providers' keys saved and shown at once, switching keeps both, the model is remembered per
  provider, Clear on one leaves the other; (2) the status bar lists the active provider's live models; (3) onboarding
  on OpenAI verifies and saves the key and makes OpenAI active; (4) an OpenAI turn's suggestion reads "By Prose ·
  GPT-5". A1's and A2's specs move to the per-provider field ids.
- Baselines: `typecheck:renderer` 66, `typecheck:e2e` 6 (`tsc -p tsconfig.node.json` 18 if shared changes touch it).
