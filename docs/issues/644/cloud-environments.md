# Oz Cloud Agent environments + guardrails

`oz agent run-cloud` executes server-side and **does not inherit the local Agent Profiles** in
[`oz-profiles.md`](oz-profiles.md). All safety must therefore live in the **environment** (least-privilege
secrets + GitHub scopes) and the **prompt** (explicit boundaries + a human-approval gate). This file specs the
Prose cloud environments and the guardrails that satisfy #644 criteria 3, 4, and 7.

## Design principle: split read-only from write-capable
Two environments, never one. The read-only one runs scheduled maintenance and can *post a report*; the
write-capable one can *change code*. They hold different secrets and different GitHub scopes, so a maintenance
run physically cannot push code.

---

## Environment A — `prose-maint` (read + comment) · **day-one**
For the recurring maintenance workflows (board/roadmap drift, stale triage). Reads the repo + board, uses Claude
to summarize, and posts a **single report** (comment or issue) behind a human-approval boundary.

| Aspect | Value |
|---|---|
| Repo checkout | `solo-ist/prose`, default branch, shallow is fine (read-only) |
| Runtime image | Node **20** (matches CI — `node-version: 20` in `.github/workflows/e2e.yml`/`web-e2e.yml`) |
| Setup commands | `npm ci` *(only if a build/lint step is needed; pure `gh`-query workflows can skip install)* |
| Secrets | `ANTHROPIC_API_KEY` (summarization). GitHub token scoped to **`issues:write` + `contents:read` only** — no `contents:write`, no `workflows`, no admin. |
| Branch/PR perms | none — this env cannot create branches or PRs. Comment/issue only. |
| Output artifact | one Markdown report comment on the durable log issue **#738**, prefixed with the `<!-- oz-maint-drift -->` sentinel for dedup |

## Environment B — `prose-build` (write-capable) · **later, only if needed**
For background work that changes code (e.g. parallel repo-wide checks, an Oz-side PR-QA pass). **Before standing
this up, confirm it isn't just duplicating the existing GitHub Actions pipeline** (`claude.yml` already does
PR-QA/review with `claude-code-action`). The scheduled maintenance runs are the clear day-one win; this is opt-in.

| Aspect | Value |
|---|---|
| Repo checkout | `solo-ist/prose`, full history (`fetch-depth: 0`) for rebase/branch work |
| Runtime image | Node **20** + Playwright deps if it runs e2e (`npx playwright install --with-deps`) |
| Setup commands | `npm ci` |
| Secrets | `ANTHROPIC_API_KEY` + `PROJECT_TOKEN` (or a PAT with `repo` scope) for branch/PR creation |
| Branch/PR perms | create branches + **draft** PRs only; **never** merge, never push to `main`/protected branches |
| Output artifact | a draft PR or a branch + summary comment, always behind human review before merge |

---

## Guardrails (criterion 7 — safety without local profiles)

1. **Least-privilege secrets.** `prose-maint` never holds a write-capable GitHub token or `PROJECT_TOKEN`.
   Each secret is attached only to the environment that needs it. No env carries `*.p8` ASC keys, signing
   identities, Sentry tokens, or `.env` contents.
2. **GitHub scope = the real boundary.** Because cloud runs ignore profiles, the GitHub token scope is what
   actually prevents damage. `prose-maint` = `issues:write`+`contents:read`; `prose-build` = `repo` but
   **no merge** and **no protected-branch push** (enforce via branch protection on `main`).
3. **Prompt boundaries.** Every cloud prompt template states explicitly what the run may and may not do, and
   ends at a **human-approval point** before any destructive or externally visible action. See the templates in
   [`recurring-workflows.md`](recurring-workflows.md).
4. **No App Store / publishing reach.** No cloud env has Transporter/altool/notarization credentials or
   `npm publish`/`gh release` ability. The App-Store-submission boundary from `CLAUDE.md` is structural here:
   the credentials simply aren't present.
5. **Hard stops mirror the local denylist.** The denylist classes in [`oz-profiles.md`](oz-profiles.md)
   (destructive FS/git, board field-def mutations, buildVersion resets) are restated in the cloud prompt
   templates as prohibitions, since there's no interactive "ask" in a headless run — the rule is "don't, and
   surface it for a human" rather than "prompt."

---

## Recreate steps (Warp UI)
1. Cloud Agents → Environments → **New environment** → name `prose-maint`; set repo `solo-ist/prose`, Node 20.
2. Setup command: `npm ci` (or leave empty for query-only runs).
3. Attach secrets: `ANTHROPIC_API_KEY`; create/attach a GitHub token scoped to `issues:write` + `contents:read`.
4. Set branch/PR permissions to **none** (comment/issue only).
5. Validate with one manual run of the workflow in [`recurring-workflows.md`](recurring-workflows.md); confirm it
   posts the report and stops at the approval gate.
6. *(Deferred)* repeat for `prose-build` with full checkout, `PROJECT_TOKEN`, and draft-PR-only permissions — only
   after confirming it doesn't duplicate the GitHub Actions pipeline.
