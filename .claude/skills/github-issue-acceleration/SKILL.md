---
name: github-issue-acceleration
description: Accelerate GitHub issue implementation by generating a Claude prompt and tracking progress via labels.
---

# GitHub Issue Acceleration

Accelerates implementation of a GitHub issue by generating a tailored prompt for Claude, applying lifecycle labels, and tracking progress through to PR creation.

## Usage

```
/github-issue-acceleration <issue-number>
```

## Phase 1: Issue Analysis

Fetch the issue and understand the scope:

```bash
gh issue view <issue-number> --json number,title,body,labels,assignees,milestone
```

Determine:
- What is being requested (feature, bug fix, chore, refactor)
- Acceptance criteria (look for checkboxes or explicit criteria sections)
- Any relevant files or components mentioned
- Complexity estimate (simple / moderate / complex)

If the issue is unclear or missing acceptance criteria, note this in the tracking comment but proceed.

## Phase 2: Label Lifecycle

Labels track the state of LLM-accelerated issues through their lifecycle:

| Label | Meaning |
|-------|---------|
| `accelerated` | Issue selected for LLM-assisted implementation |
| `accelerated:in-progress` | Claude is actively implementing |
| `accelerated:pr-open` | PR created, awaiting human review |

### Lifecycle transitions

```
Issue selected
    └─▶ accelerated
            └─▶ accelerated:in-progress  (Claude begins work)
                    └─▶ accelerated:pr-open  (PR created)
```

Transitions use `--remove-label` + `--add-label` to keep exactly one `accelerated:*` label active:

```bash
# Transition to in-progress
gh issue edit <issue-number> \
  --remove-label "accelerated" \
  --add-label "accelerated:in-progress"

# Transition to pr-open
gh issue edit <issue-number> \
  --remove-label "accelerated:in-progress" \
  --add-label "accelerated:pr-open"
```

## Phase 3: Prompt Generation

Generate a focused implementation prompt for Claude. The prompt must include:

1. **Context**: What the issue is asking for and why
2. **Acceptance criteria**: What "done" looks like (pull directly from issue)
3. **Relevant files**: Key files Claude should read first (based on issue scope)
4. **Constraints**: Any architectural guidelines from CLAUDE.md relevant to this issue
5. **Branch name**: Convention is `issue-<number>-<short-description>`

### Prompt template

```
Implement GitHub issue #<number>: <title>

## Context

<1-2 sentence summary of what the issue is asking for>

## Acceptance Criteria

<paste acceptance criteria from issue verbatim>

## Key Files to Read First

- <file-or-directory>: <reason>

## Constraints

- Follow existing patterns in <relevant area>
- Use shadcn/ui components only (no new UI libraries)
- <any other relevant CLAUDE.md constraints>

## Branch

Work on branch: `issue-<number>-<short-description>`
```

## Phase 4: Tracking Comment

Create a tracking comment on the issue so progress is visible:

```bash
gh issue comment <issue-number> --body "$(cat <<'EOF'
## Acceleration Queued

This issue has been queued for LLM-assisted implementation.

**Status**: Waiting for Claude session to begin
**Branch**: `issue-<number>-<short-description>` (will be created by Claude)

The implementation prompt has been generated. Progress will be tracked via labels:
- `accelerated` → selected
- `accelerated:in-progress` → Claude working
- `accelerated:pr-open` → PR ready for review
EOF
)"
```

## Phase 5: Execution

Choose the execution path based on available tooling.

### Phase 5.1 — GitHub Actions Workflow (via `@claude` comment)

1. Add `accelerated` label to the issue
2. Add `@claude` comment with the generated prompt
3. Update label to `accelerated:in-progress`
4. Monitor for PR creation
5. On PR created: Update label to `accelerated:pr-open`

```bash
# Step 1: Add accelerated label
gh issue edit <issue-number> --add-label "accelerated"

# Step 2: Post @claude comment
gh issue comment <issue-number> --body "@claude <generated-prompt>"

# Step 3: Update to in-progress (after confirming Claude picked up the task)
gh issue edit <issue-number> \
  --remove-label "accelerated" \
  --add-label "accelerated:in-progress"

# Step 5: On PR created, update label
gh issue edit <issue-number> \
  --remove-label "accelerated:in-progress" \
  --add-label "accelerated:pr-open"
```

> **Why not automate labeling via GitHub Actions?**
> The `@claude` comment trigger is used for non-acceleration tasks too. Adding the label at the workflow level would incorrectly tag unrelated uses. Labeling is applied intentionally as part of this skill's own execution steps.

### Phase 5.2 — Claude Code Desktop (manual session)

Use this path when Claude Code Desktop is available and GitHub Actions is not configured or not preferred.

1. Add `accelerated` label to the issue
2. Generate session prompt (see Phase 3)
3. Create tracking comment on issue (see Phase 4)
4. Provide prompt to user for copy/paste into Claude Code Desktop
5. User runs session and creates PR manually
6. Update label when PR is linked

```bash
# Step 1: Add accelerated label
gh issue edit <issue-number> --add-label "accelerated"

# Step 3: Create tracking comment
gh issue comment <issue-number> --body "$(cat <<'EOF'
## Acceleration Session Started

**Status**: Claude Code Desktop session in progress
**Branch**: `issue-<number>-<short-description>`
EOF
)"

# Step 6: On PR linked, update label
gh issue edit <issue-number> \
  --remove-label "accelerated" \
  --add-label "accelerated:pr-open"
```

## Troubleshooting

### Label not found

Ensure the labels exist in the repository before applying:

```bash
gh label list | grep accelerated
```

If missing, create them:

```bash
gh label create "accelerated" --color "0075ca" --description "Selected for LLM-assisted implementation"
gh label create "accelerated:in-progress" --color "e4e669" --description "Claude is actively implementing"
gh label create "accelerated:pr-open" --color "0e8a16" --description "PR created, awaiting human review"
```

### @claude comment not picked up

Verify the `claude.yml` workflow is active and the trigger phrase matches:

```bash
gh workflow list
gh workflow view claude.yml
```

### PR not linked to issue

Ensure the PR body contains `Closes #<issue-number>` or `Fixes #<issue-number>`. Claude should include this automatically when given the issue number in the prompt.
