---
name: github-issue-acceleration
description: Accelerate GitHub issue resolution using LLM automation. Manages the full lifecycle from issue selection to PR creation, including label tracking.
---

# GitHub Issue Acceleration

Automates the resolution of GitHub issues by generating focused implementation prompts and routing them through the appropriate LLM workflow. Tracks progress via labels throughout the lifecycle.

## Usage

```
/github-issue-acceleration [issue-number]
```

If no issue number is provided, select one from the project board's "Do First" column.

## Phase 1: Issue Selection

If no issue number is provided:

```bash
gh project item-list 5 --owner solo-ist --format json
```

From the "Do First" column, select the highest-priority unblocked issue that:
- Has a clear description with defined acceptance criteria
- Is not already in progress (no open branch matching `issue-<number>-*`)
- Has no blocking dependencies on other open issues

Present the selected issue to the user and ask for confirmation before proceeding.

If an issue number is provided, fetch its details:

```bash
gh issue view <issue_number> --json number,title,body,labels,assignees
```

## Phase 2: Label Management

### 2.1 Label Setup

Ensure the required labels exist on the repository:

```bash
gh label list --json name | jq '.[].name'
```

Required labels:
- `accelerated` — issue has been queued for LLM acceleration
- `accelerated:in-progress` — LLM agent is actively working on the issue
- `accelerated:pr-open` — agent has created a PR, awaiting human review

Create missing labels:

```bash
gh label create "accelerated" --color "0075ca" --description "Queued for LLM acceleration"
gh label create "accelerated:in-progress" --color "e4e669" --description "LLM agent actively working"
gh label create "accelerated:pr-open" --color "0e8a16" --description "Agent PR open, awaiting human review"
```

### 2.2 Label Lifecycle

| Event | Label Action |
|-------|-------------|
| On acceleration start | Add `accelerated` label ← Phase 5.1 step 1 / Phase 5.2 step 1 |
| On @claude comment posted | Update to `accelerated:in-progress` (remove `accelerated`) ← Phase 5.1 step 3 |
| On PR created | Update to `accelerated:pr-open` (remove `accelerated:in-progress`) ← Phase 5.1 step 5 |
| On PR merged | Remove all `accelerated*` labels |

The `accelerated` label is always the first thing applied — before any comments are posted or prompts are generated. This ensures the issue is visibly marked as queued even if subsequent steps are interrupted.

## Phase 3: Prompt Generation

Read the issue body and any linked context to generate a focused implementation prompt.

The prompt should include:
- Issue number and title
- Summary of the problem or feature request
- Relevant acceptance criteria (extracted from the issue body)
- Key files to examine (based on the issue description)
- Suggested implementation approach (if apparent)
- Reference to repository conventions (CLAUDE.md)

```bash
# Read full issue details
gh issue view <issue_number> --json number,title,body,comments

# Look for related PRs or branches
gh pr list --search "#{issue_number}" --json number,title,headRefName,state
git branch -r | grep -E "origin/.*${issue_number}-" | head -5
```

Format the prompt for the target workflow (see Phase 5).

## Phase 4: Workflow Selection

Ask the user which workflow to use:

**Option A — GitHub Actions (@claude comment)**
- Posts a comment with `@claude` and the generated prompt
- Claude Code picks it up automatically via the workflow trigger
- Better for issues that can be resolved asynchronously
- Label updates happen in the comment workflow

**Option B — Claude Code Desktop (manual session)**
- Generates a session prompt for the user to paste into Claude Code Desktop
- Better for issues requiring interactive debugging or complex exploration
- User runs the session and creates the PR manually
- User must update labels manually after PR creation

Present options with AskUserQuestion and wait for selection.

## Phase 5: Execution

### 5.1 GitHub Actions Workflow (@claude comment)

1. **Add `accelerated` label** to the issue
   ```bash
   gh issue edit <issue_number> --add-label "accelerated"
   ```
2. Add @claude comment with the generated prompt
   ```bash
   gh issue comment <issue_number> --body "@claude <generated-prompt>"
   ```
3. Label updates to `accelerated:in-progress` (when agent picks up work — handled automatically by the claude.yml workflow or by the agent itself on startup)
4. Monitor for PR creation
   ```bash
   gh pr list --search "#{issue_number}" --json number,headRefName,state
   ```
5. On PR created: Update label to `accelerated:pr-open`
   ```bash
   gh issue edit <issue_number> \
     --remove-label "accelerated:in-progress" \
     --add-label "accelerated:pr-open"
   ```

### 5.2 Claude Code Desktop Workflow

1. **Add `accelerated` label** to the issue
   ```bash
   gh issue edit <issue_number> --add-label "accelerated"
   ```
2. Generate session prompt (see Phase 3 output)
3. Create a tracking comment on the issue
   ```bash
   gh issue comment <issue_number> --body "Acceleration session started. Prompt generated for Claude Code Desktop."
   ```
4. Provide the prompt to the user for copy/paste into Claude Code Desktop
5. User runs the session and creates a PR manually
6. Update label when PR is linked
   ```bash
   gh issue edit <issue_number> \
     --remove-label "accelerated:in-progress" \
     --add-label "accelerated:pr-open"
   ```

## Phase 6: Handoff

After execution starts, report to the user:

```markdown
## Acceleration Started

**Issue**: #<number> — <title>
**Label**: `accelerated` applied ✓
**Workflow**: <GitHub Actions | Claude Code Desktop>

### Next Steps

- Watch for a PR to be created at `claude/issue-<number>-*`
- Run `/qa-accelerated` to validate the implementation once a PR is open
- Merge only after human review
```

## Key Principles

- **Label first, always.** Apply `accelerated` before any comment or prompt is sent. This ensures the issue is visibly queued even if the workflow is interrupted.
- **Never auto-merge.** All PRs require human review.
- **One issue at a time.** Don't queue multiple issues simultaneously unless explicitly requested.
- **Respect acceptance criteria.** The generated prompt must reference the issue's acceptance criteria directly.
