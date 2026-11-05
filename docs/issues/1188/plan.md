# #1188 — First-run onboarding: one multi-step modal

Issue: https://github.com/solo-ist/prose/issues/1188 (epic #1094). Design package: `docs/issues/1188/design/` (PR #1189,
merged). Branch `issue-1188-onboarding` from `release/v1.9.0` = `bbb1873`; renderer-only; one PR, merge commit, green
CI and claude review. Pulled into 1.9.0 by the operator on 2026-11-04 ("one last thing before we get the release out").

## Decisions (operator, 2026-11-04, the issue's three open questions)

1. **Crash reports start unchecked.** Matches the public "opt-in, off by default"; Settings keeps the toggle.
2. **Escape:** ignored until the AI choice is made (steps 1–2); afterwards it jumps to Done, and on Done it finishes
   (writes what was chosen, closes). e2e's fresh-profile dismissal drives the modal instead of Escaping blindly.
3. **Default editor step is skipped when Prose is already the `.md` default** (`fileAssociationIsDefault() === true`;
   `null` counts as not default, as the old prompt did), and `hasBeenPrompted` is still written at Done.

## What exists today (confirmed)

- `AIConsentDialog` (two internal steps: consent + crash checkbox, then the Skill download on direct builds), opened
  by `App.tsx` when `aiConsent` is missing or its `version` is below `AI_CONSENT_VERSION`, and by Settings' AI toggle
  when enabling without consent. `DefaultHandlerPrompt` opens on a 1 s timer when `fileAssociation.hasBeenPrompted`
  is unset and Prose is not known to be the default. The API key lives in Settings → AI: the store's
  `settings.llm.apiKey` is sent with `settings:save`, where main moves it into `credentialStore` (Keychain) and strips
  it from disk, so "saved to Keychain" is the truth of the existing path. `testApiKey`, `downloadSkill`, `mcpInstall`,
  `mcpGetStatus`, `fileAssociationIsDefault`, `openExternal` and `isMasBuild` are all on `window.api` already.
- No main-process change is needed; nothing under `src/main` or `src/preload` moves.

## Change

- **`components/onboarding/steps.ts`** (pure, unit-tested): `sequenceFor({ ai, direct, defaultAlready })` gives the
  steps that apply (`welcome`, `ai`, `key` unless AI is declined, `claude` on direct builds, `default` unless already
  default, `done`); the key step stays in the count until AI is declined, so Welcome reads "1 / 6" before the choice,
  as the design renders. `resolveStep` moves a step that fell out of the sequence to the next one that applies.
  `summaryRows` builds the Done table (AI assistance, Crash reports, Claude Skill and Desktop on direct builds,
  Default for `.md`).
- **`components/onboarding/OnboardingDialog.tsx`**: one Radix alert dialog (no outside-click dismiss), 520×560,
  header `n / total · LABEL` with the segment bar, scrolling body, footer with Back / secondary / primary. Theme tokens
  throughout (the design's dark render is the dark theme); Fraunces italic only for the Welcome and Done headings,
  the brand mark is the `ProseMark` vector (#1063). Answers are held in memory; **Done writes** `aiConsent`,
  `errorTracking.enabled` and, when the step was acknowledged or skipped as already default,
  `fileAssociation.hasBeenPrompted`. Side effects run when their button is pressed and Back never undoes them: Verify
  checks the key format (`validateApiKeyFormat`) then `testApiKey`, and on success stores it through
  `setLLMConfig` + `saveSettings` (the Settings path); Download runs `downloadSkill`; Install runs `mcpInstall`
  (pre-set to Installed when `mcpGetStatus` says so). Re-entry (`startAt: 'ai'` for a stale consent version or the
  Settings toggle) keeps the crash checkbox at the current setting and shows an existing key as already in the
  Keychain. The design's "Show me" button (open Get Info on a sample file) needs main-process work and is left out;
  the four-step list stays.
- **`App.tsx`**: the consent gate stays (same seam, same flag, so Settings' toggle still reopens it), feeds
  `OnboardingDialog` with `startAt` (`'ai'` when an `aiConsent` record exists) and runs the Done action (New document
  → `createNewTab`, Open file… → `openFile`). `DefaultHandlerPrompt` stays only as the **later-launch re-prompt** for
  "Remind me later": it is mounted only when consent was already current when settings loaded, so it never stacks on
  onboarding nor follows it in the same session. `AIConsentDialog.tsx` is deleted.
- **e2e**: `dismissOnboarding` / `dismissConsentDialog` drive the modal on a fresh profile (Get started → Write without
  AI → Continue → Escape → Escape) before the old Escape loop; specs that seed consent are untouched.

## Tests

- vitest `steps.test.ts`: the four sequences (direct/App Store × AI on/off), the already-default skip, `resolveStep`,
  the summary rows and tones.
- `e2e/electron.onboarding.spec.ts` (fresh `PROSE_USER_DATA_DIR`, no `settings.json`; the release-notes modal is
  off while consent is due): direct build, AI on: one alert dialog, "1 / 6", Continue disabled and Escape inert
  before a choice, a malformed key rejected with Continue disabled, skip through to Done with "Remind me later", New
  document closes it, `settings.json` holds `consented: true`, `errorTracking.enabled: false`, no `hasBeenPrompted`,
  and no second dialog follows; AI off: "2 / 5", Escape jumps to Done, Back works from Done, Escape finishes,
  `consented: false`; `MAS_BUILD=1`: "App Store build", four steps, Continue on the default step writes
  `hasBeenPrompted`; a stale consent version re-enters at "2 / 6 · AI and privacy". Falsified on a build of the
  merge-base (no modal there). Skill download and the already-default skip are manual QA (a save dialog; a
  Launch Services answer the spec cannot force).

## Execution log

- 2026-11-04 (late): inventory, decisions, plan.
