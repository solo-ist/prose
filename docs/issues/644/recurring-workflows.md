# Oz recurring Cloud Agent workflows

Satisfies #644 criteria 5 + 6. The **day-one** workflow is the scheduled maintenance run below — it has no
equivalent in the existing GitHub Actions pipeline and zero overlap with it, so it's the lowest-conflict win.
The remaining candidates are catalogued but deliberately **not** wired first (rationale per row).

---

## Wired first — `oz-maint-drift` (scheduled board/roadmap drift + stale triage)

Reuses the logic of the [`roadmap-refinement`](../../../.claude/skills/roadmap-refinement/) skill, but runs on a
schedule in the cloud and **only proposes** — it never mutates the board or closes issues.

| Field | Value |
|---|---|
| **Trigger** | Scheduled (cron) — weekly, e.g. Mondays 14:00 UTC |
| **Environment** | [`prose-maint`](cloud-environments.md) (read + comment) |
| **Secrets / perms** | `ANTHROPIC_API_KEY`; GitHub token `issues:write` + `contents:read`. No code-write, no merge. |
| **Output artifact** | One Markdown **report** posted as a comment on the durable log issue [**#738**](https://github.com/solo-ist/prose/issues/738), tagged `<!-- oz-maint-drift -->` for dedup |
| **Review boundary** | The report only *recommends* (close candidates, NO-STATUS items, stale flags, doc-drift). A human runs the actual `gh project item-*` / `gh issue close` actions — exactly the approval gate in the `roadmap-refinement` skill ("present, don't act"). The cloud run performs **no** board or issue mutations. |

### Prompt template (guardrailed)
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

### Recreate steps (Warp UI)
1. Cloud Agents → Workflows → **New workflow** → name `oz-maint-drift`; environment `prose-maint`.
2. Trigger: schedule, weekly cron.
3. Paste the prompt template above.
4. Run once manually → confirm a single sentinel-tagged report posts and **nothing** on the board/issues changed.
5. Tick acceptance criteria 5 + 6.

---

## Candidate backlog (not wired day-one)

| Candidate | Trigger | Why not first |
|---|---|---|
| **Stale-issue / done-but-open cleanup** | scheduled | **Fold into `oz-maint-drift`** — same read-only report, one run covers both. (Effectively already wired.) |
| **Scheduled maintenance triage** | scheduled | Same shape as drift; add as a section of the weekly report once the first run is proven. |
| **PR QA / review pass before merge** | GitHub event | **Overlaps the existing pipeline** — `claude.yml` + `ci-gate.yml` already auto-review PRs on green E2E. Only build an Oz version if it adds something the Actions path can't (and decide replace-vs-supplement first). Needs the write-capable `prose-build` env. |
| **Background investigation tasks** | manual / scheduled | Ad-hoc; wire on demand, not as a standing schedule. |
| **Parallelizable repo-wide checks** | manual / scheduled | Genuine cloud win (parallelism), but define the specific check first; needs `prose-build`. Candidate once the QoL Pass 2 surfaces a concrete repo-wide sweep. |

---

## Why this satisfies "Cloud only where it adds value"
The day-one workflow is **scheduled, background, team-visible, and read-only** — exactly the profile #644 calls
out for Cloud Agents ("background execution, scheduling, integrations, audit trails") — while the things the
local pipeline already does well (event-driven PR QA) stay on GitHub Actions. No duplication, clear value add.
