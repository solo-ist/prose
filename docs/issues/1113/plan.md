# #1113 — e2e fixtures seed aiConsent without lastSeenVersion, so specs run under an undismissed release-notes modal

Issue: https://github.com/solo-ist/prose/issues/1113 (epic #1094; found while fixing #1096, a candidate cause for
#1085's rotating flakiness). Branch `issue-1113-seed-settings` from `release/v1.9.0`; test-only; one PR. Tranche 3
(2026-11-04).

## Mechanism, confirmed

The post-update release notes are suppressed only while the AI consent dialog is due (`App.tsx` records the
version silently in that case). A fixture that seeds `aiConsent: { version: 1 }` makes consent not due, so the
modal opens on launch unless `lastSeenVersion` is seeded too. `dismissOnboarding` Escapes `[role="alertdialog"]`
(the consent dialog), not the notes `Dialog`; `dismissOverlay` happens to Escape it when a spec calls it, which is
why some specs never noticed. Today 17 Electron specs seed consent and 8 seed the version; of the 9 without it, 7
are Electron specs (two are browser specs, where the notes IPC does not exist). The seven specs this session added
seeded `lastSeenVersion: '0.0.0'`, which does not suppress anything either.

## Change

- `e2e/helpers.ts`: `seedSettings(userDataDir, overrides)` writes the profile's `settings.json` with a baseline
  (`fileAssociation.hasBeenPrompted`, a consented `aiConsent`, `lastSeenVersion` = this build's version from
  `package.json`) and the spec's keys on top, a key replacing the baseline key wholesale (a spec testing consent
  passes its own `aiConsent`).
- The 12 Electron specs on this base that seed consent without the version (the 7 from the issue and 5 from this
  session; the two on open branches follow once they merge) call it instead of writing the file by hand, keeping
  their own keys.
- `e2e/electron.seed-settings.spec.ts`: a source-level check that every Electron spec seeding `aiConsent` goes
  through the helper or seeds `lastSeenVersion`, so the class stays closed.

## Tests

The tripwire above, falsified against the specs as they were (it lists the seven). The converted specs run on the
built app locally (a sample) and in CI (all). The #1085 comparison the issue asks for (several full-suite runs,
failure distribution before and after) is a separate observation once this has been on the branch for a few CI
runs; recorded on #1085 when done.

## Execution log

- 2026-11-04: inventory (above).
