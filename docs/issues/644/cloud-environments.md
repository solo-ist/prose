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

## Environment A — `prose-maint` · `sJWY3YRhhmWx4CnNEr4ZUA` (read + comment)
For the recurring maintenance workflows (board/roadmap drift, stale triage). Reads the repo + board, uses Claude
to summarize, and posts a **single report** (comment or issue) behind a human-approval boundary.

| Aspect | Value |
|---|---|
| Repo checkout | `solo-ist/prose`, default branch |
| Runtime image | `warpdotdev/dev-base:latest-agents` (bundles `gh` + agent CLIs) |
| Setup commands | `cd prose && npm ci --legacy-peer-deps` · `apt-get install -y zip 2>/dev/null \|\| true` · `git config --global user.email '442369+mrangelmarino@users.noreply.github.com'` · `git config --global user.name 'Angel Marino'` |
| GitHub auth | Runtime `GH_TOKEN` from the Oz App — **do not** `gh auth login` in setup (secrets not injected at setup time) |
| Secrets | `ANTHROPIC_API_KEY` |
| Branch/PR perms | none — comment/issue only |
| Output artifact | one Markdown report comment on the durable log issue **#738**, prefixed with the `<!-- oz-maint-drift -->` sentinel for dedup |

## Environment B — `prose-build` · `erUdWNSiECqkTQ7BXj6J4Y` (write-capable)
For implementation children (one per issue). Creates branches + PRs (ready for review by default, per the
`implement-issue` skill); never merges, never pushes `main`.

| Aspect | Value |
|---|---|
| Repo checkout | `solo-ist/prose`, full history |
| Runtime image | `warpdotdev/dev-base:latest-agents` |
| Setup commands | `cd prose && npm ci --include=dev --no-audit --no-fund` · `apt-get install -y zip 2>/dev/null \|\| true` · `git config --global user.email '442369+mrangelmarino@users.noreply.github.com'` · `git config --global user.name 'Angel Marino'` |
| GitHub auth | Runtime `GH_TOKEN` from the Oz App — already authenticated for clone/branch/PR. No setup-phase token needed |
| Secrets | `ANTHROPIC_API_KEY` |
| Branch/PR perms | create branches + PRs (draft **or** ready-for-review); branch protection (`enforce_admins`) blocks merge / push-to-main |

> **Setup command rationale:** `zip` is needed for `npm run build`'s `build:skill` step (absent from the base
> image by default). The git noreply email pre-empts the GH007 push rejection every agent otherwise hits.
> Both were discovered during the Wave-1 friction audit (June 2026) and patched into the live envs.

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

## Recreate steps (CLI)

```bash
# prose-maint (read + comment)
oz environment create \
  --name prose-maint \
  --docker-image warpdotdev/dev-base:latest-agents \
  --repo solo-ist/prose \
  --setup-command "cd prose && npm ci --legacy-peer-deps" \
  --setup-command "apt-get install -y zip 2>/dev/null || true" \
  --setup-command "git config --global user.email '442369+mrangelmarino@users.noreply.github.com'" \
  --setup-command "git config --global user.name 'Angel Marino'"
# Attach ANTHROPIC_API_KEY secret; set branch/PR perms = none

# prose-build (write-capable)
oz environment create \
  --name prose-build \
  --docker-image warpdotdev/dev-base:latest-agents \
  --repo solo-ist/prose \
  --setup-command "cd prose && npm ci --include=dev --no-audit --no-fund" \
  --setup-command "apt-get install -y zip 2>/dev/null || true" \
  --setup-command "git config --global user.email '442369+mrangelmarino@users.noreply.github.com'" \
  --setup-command "git config --global user.name 'Angel Marino'"
# Attach ANTHROPIC_API_KEY secret; set branch/PR perms = branches + PRs (draft or ready-for-review)
```

Validate `prose-build` with a single smoke-test run before fanning out:
```bash
oz agent run-cloud -e <ENV_ID> -n smoke \
  -p "Run: gh issue view 1 -R solo-ist/prose --json number,title && echo OK"
```
