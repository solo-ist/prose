# #644 — Oz setup: profiles, cloud environments, recurring workflows

**Status:** specs drafted (agent) · in-Warp creation pending (human) · **gate for the QoL Pass 2 parallelization push**

"Oz" is Warp's agent product. It has two execution surfaces with **separate** safety models:

- **Local Agent Profiles** — permission postures for interactive local/CLI agent work, configured **inside Warp**.
- **Cloud Agent runs** (`oz agent run-cloud`) — isolated server-side executions that **do not inherit local profiles**, so safety must be encoded in the environment + prompt instead.

This folder is the recreate-from-scratch documentation required by #644's acceptance criteria. The actual profile/environment creation happens in the Warp UI (human) against these specs; the docs make it reproducible.

## Documents

- `oz-profiles.md` — the two local Agent Profiles (Trusted Coding, Review/Untrusted), mapped onto the repo's existing `.claude/settings.json` posture.
- `cloud-environments.md` — the Prose Cloud Agent environments (read-only `prose-maint`, write-capable `prose-build`) + the cloud guardrails.
- `recurring-workflows.md` — the first wired recurring workflow (scheduled board/roadmap drift + stale triage) and the candidate backlog.

## Acceptance criteria — owner + status

| \# | Criterion | Owner | Status |
| --- | --- | --- | --- |
| 1 | `Trusted Coding` profile exists & usable | Human (Warp UI) | spec ready → `oz-profiles.md` |
| 2 | `Review / Untrusted` profile exists & usable | Human (Warp UI) | spec ready → `oz-profiles.md` |
| 3 | ≥1 Prose Cloud Agent environment configured & validated | Human (Warp UI) | spec ready → `cloud-environments.md` |
| 4 | Cloud environment documented well enough to recreate | Agent | ✅ `cloud-environments.md` |
| 5 | ≥1 recurring Cloud Agent workflow wired end-to-end | Human (Warp UI) + Agent | spec + prompt ready → `recurring-workflows.md` |
| 6 | Each cloud workflow documents trigger / perms / secrets / artifact / review boundary | Agent | ✅ `recurring-workflows.md` |
| 7 | Cloud workflows don't rely on local profile settings for safety | Agent (design) + Human (config) | ✅ designed → `cloud-environments.md` §Guardrails |

## In-Warp setup checklist (human, in order)

1. **Profiles** — create `Trusted Coding` and `Review / Untrusted` per `oz-profiles.md`. Set the default to `Trusted Coding` for this repo.
2. **Cloud environment** — stand up `prose-maint` (read + comment) per `cloud-environments.md`: repo checkout, Node pinned to the e2e workflow's version, `npm ci` restore, attach `ANTHROPIC_API_KEY` + an issues:write/contents:read GitHub token.
3. **Recurring workflow** — wire the scheduled **board/roadmap drift + stale triage** run from `recurring-workflows.md`: cron trigger, `prose-maint` env, the guardrailed prompt, output = a single report comment/issue behind a human-approval gate (no auto-mutation).
4. **Validate** — trigger one run manually; confirm it produces the report artifact and stops at the approval boundary. Tick criteria 1–3, 5.
5. *(Later, only if needed)* stand up the write-capable `prose-build` env for background PR-QA — but first decide whether it duplicates the existing GitHub Actions pipeline (`claude.yml`/`ci-gate.yml`); the scheduled maintenance runs are the day-one win.

## Source-of-truth links

- Local posture this mirrors: `.claude/settings.json` (deny/allow lists).
- House rules the denylist encodes: `CLAUDE.md` (no App Store submission; monotonic buildVersion; PID-file process mgmt; `gh` not MCP; board hygiene).
- Existing GitHub Actions cloud pipeline (do not duplicate): `.github/workflows/{claude,ci-gate,pipeline-triage,pipeline-fix,dispatch}.yml`.
- The maintenance logic the first workflow reuses: `.claude/skills/roadmap-refinement/`.