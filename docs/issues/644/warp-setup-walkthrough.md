# Oz / Warp setup walkthrough (#644)

A turnkey, do-this-now runbook for the in-Warp config that opens the Oz gate. Values are pulled from the recreate specs in this folder (`oz-profiles.md`, `cloud-environments.md`, `recurring-workflows.md`) so you don't have to flip between files.

You drive the Warp UI; the agent verifies the run at the end (Step 5 handshake).

---

## Step 1 — Local profiles

**Warp → Settings → Agents → Profiles**

### Profile `Trusted Coding` (set as default for the prose workspace)

| Axis | Set to |
| --- | --- |
| Read files | Always allow |
| Create plans | Agent decides |
| Apply code diffs | Agent decides |
| Execute commands | Agent decides |
| Interact with running commands | Agent decides |

**Allowlist (auto-run):**

```
npm run *    npx *    node *    lsof *    ps *    sleep *
kill <pid>   cat .dev.pid*
git status*  git diff*  git log*  git branch*  git fetch*  git show*
ls *
gh issue *   gh pr *   gh project *   gh run *   gh api *
```

**Denylist (always ask)** — high-value entries (full list in `oz-profiles.md`):

| Class | Always-ask |
| --- | --- |
| Read secrets | `.env`, `.env.sentry-build-plugin`, `.mcp.json`, `build/*.provisionprofile`, `*.p8` |
| Destructive FS/git | `rm -rf`, `git reset --hard`, `git push --force`, any push to `main` |
| Process footguns | `pkill -f node` (kills Circuit MCP), `pkill -f Electron` (kills all Electron) |
| Publishing | `npm publish`, `gh release *`, `xcrun iTMSTransporter`/`altool`, `vercel --prod` |
| App Store | **submission for review = hard stop** (TestFlight upload is the human edge) |
| MAS versioning | `buildVersion` resets (it's global-monotonic) |
| Board | GraphQL `updateProjectV2Field` (wipes board status) |

### Profile `Review / Untrusted`

Same reads, but **Apply code diffs = Always ask** and **Execute commands = Always ask** (narrow read-only allowlist only: `git status/diff/log/show`, `ls`, `gh * view`/`gh pr diff`). The Trusted denylist still applies.

---

## Step 2 — GitHub token for the cloud env

**GitHub → Settings → Developer settings → Fine-grained personal access token**

This token scope is the real safety boundary for cloud runs (cloud ignores local profiles). Scope it narrowly:

- **Resource owner:** `solo-ist`
- **Repository access:** only `solo-ist/prose`
- **Repository permissions:**
  - Issues → **Read and write**
  - Contents → **Read-only**
  - Metadata → Read (auto)
- **Organization permissions:**
  - Projects → **Read-only** ← required so the drift report can read board #5

Copy the token; paste it as a secret in Step 3.

> You *could* reuse an existing PAT to move fast, but it's broader than ideal — a fresh narrow one means `prose-maint` physically cannot write code.

---

## Step 3 — Cloud environment `prose-maint`

**Warp → Cloud Agents → Environments → New**

| Setting | Value |
| --- | --- |
| Repo | `solo-ist/prose` |
| Runtime | **Node 20** (matches CI) |
| Setup command | `npm ci` *(optional for this query-only workflow — fine to leave empty)* |
| Secrets | `ANTHROPIC_API_KEY` + the fine-grained PAT from Step 2 |
| Branch/PR permissions | **none** (comment/issue only) |

---

## Step 4 — Workflow `oz-maint-drift`

**Warp → Cloud Agents → Workflows → New**

- Environment: `prose-maint`
- Trigger: **Schedule**, weekly (e.g. Mon 14:00 UTC)
- Prompt:

```
You are a read-only maintenance agent for solo-ist/prose. Produce a backlog-drift REPORT and post it as a
single comment — that comment post is the ONE and ONLY write action you may take. You may NOT close issues,
edit the project board, push code, or take any other externally visible action.

Gather state with `gh` (issues, PRs, project #5) and read docs/roadmap.md. Then compose the report, as Markdown:
  1. Done-but-open: open issues whose work merged (linked merged PR / issue-<n>-* branch).
  2. Board drift: NO-STATUS board items; closed-but-still-on-board items; open issues missing from the board.
  3. Stale: issues with no activity in 60+ days (note which are intentionally On Hold).
  4. Roadmap drift: where docs/roadmap.md disagrees with the board.

REQUIRED final step — post the report (do NOT skip this; do NOT merely print it to the run log):
  Write the report to a file whose FIRST line is the sentinel `<!-- oz-maint-drift -->`, then run exactly:
    gh issue comment 738 -R solo-ist/prose --body-file <that-file>
  Issue #738 is the durable log; one comment per run.

Rules:
  - The single `gh issue comment 738` post above is permitted and REQUIRED. Beyond it: recommend, never
    execute — NO `gh issue close`, no `gh project item-edit/archive`, no GraphQL field mutations, no code push.
  - End the report body with: "All actions above require a human to run roadmap-refinement and approve each change."
```

---

## Step 5 — Validate (handshake)

In Warp, **run** `oz-maint-drift` **once manually**. When it finishes, **ping the agent**. It will confirm via `gh`that the run:

- posted exactly one `<!-- oz-maint-drift -->` report as a comment on issue [**#738**](https://github.com/solo-ist/prose/issues/738),
- changed **nothing** on the board or issues,
- stopped at the human-approval boundary.

That ticks acceptance criteria 1/2/3/5 and **opens the gate** for the QoL Pass 2 parallelization push. The agent then updates `notes.md` to close out the Phase 0 gate.

---

### Snag-busting

- **Report ran but nothing posted to GitHub** (only appeared in the Warp run log) → the prompt's "never execute" rule smothered the one allowed post, **or** the token lacks **Issues: Read and write**. The prompt now names the `gh issue comment 738` post as REQUIRED; confirm the Step 2 token has Issues **write** (not read-only).
- `gh project` call errors in the run → almost always the **Projects: Read** org permission missing on the Step 2 token.
- Run wants to write code / open a PR → the env has too-broad branch/PR permissions or a too-broad token; tighten to comment/issue only.
- Anthropic auth error → `ANTHROPIC_API_KEY` not attached to `prose-maint`.