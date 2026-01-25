---
name: qa-accelerated
description: Validate all LLM-accelerated GitHub issues through systematic QA testing via Circuit Electron.
---

# QA Accelerated Issues

Validates all issues with `accelerated` labels through systematic QA testing. This skill complements automated issue implementation by providing rigorous validation before human review.

## Usage

```
/qa-accelerated
```

## Safety

**CRITICAL**: This skill never auto-approves or auto-merges PRs. All merges require human approval.

## Workflow Overview

```
1. Discovery     → Find all accelerated issues
2. Planning      → Create testing order (dependencies, complexity)
3. Per-Issue     → For each issue:
   a. Find branch/PR state
   b. Checkout branch locally
   c. Build and test via Circuit Electron
   d. Create/update PR with findings
4. Summary       → Report overall status
```

## Phase 1: Discovery

Find all accelerated issues using GitHub CLI:

```bash
# Find issues with any accelerated label
gh issue list --label "accelerated" --json number,title,labels,state --state all
gh issue list --label "accelerated:in-progress" --json number,title,labels,state
gh issue list --label "accelerated:pr-open" --json number,title,labels,state
```

Combine results and deduplicate by issue number.

For each issue, determine:
- Issue number and title
- Current label state (`accelerated`, `accelerated:in-progress`, `accelerated:pr-open`)
- Whether a PR exists
- Branch name

```bash
# Find PRs referencing an issue
gh pr list --search "#{issue_number}" --json number,title,headRefName,state

# Find branches matching pattern (convention: {type}/{issue-number}-*)
git fetch origin
git branch -r | grep -E "origin/(feat|fix|refactor|spike|chore)/${issue_number}-"
```

If no accelerated issues are found, report this and exit.

## Phase 2: Test Planning

Create an ordered test plan considering:

1. **PR state priority**:
   - `accelerated:pr-open` first (PR exists, needs validation)
   - `accelerated:in-progress` next (work done, may need PR)
   - `accelerated` last (may not have work yet)

2. **Dependency ordering**: If issue A depends on issue B, test B first

3. **Skip issues without branches**: If no branch exists, note as "No work found"

Present plan to user using AskUserQuestion:

```markdown
## QA Test Plan for Accelerated Issues

| Order | Issue | Title | State | PR | Branch |
|-------|-------|-------|-------|-----|--------|
| 1 | #38 | Copy-to-clipboard | pr-open | #42 | feat/38-copy |
| 2 | #93 | Suggestion feedback | in-progress | - | feat/93-feedback |
| 3 | #101 | Theme persistence | accelerated | - | (no branch) |

Proceed with this order?
```

Wait for user confirmation before proceeding.

## Phase 3: Per-Issue Testing

For each issue in the plan (skip those without branches):

### 3.1 Branch/PR Discovery

```bash
# Check for existing PR
gh pr list --search "#{issue}" --json number,headRefName,state --jq '.[0]'

# If no PR, look for branch
git branch -r | grep -E "origin/(feat|fix|refactor|spike|chore)/${issue}-" | head -1 | sed 's|origin/||' | tr -d ' '
```

### 3.2 Checkout and Build

```bash
# Kill stale processes first
pkill -f "Electron.app" 2>/dev/null || true
pkill -f "electron-vite" 2>/dev/null || true

# Fetch and checkout
git fetch origin
git checkout <branch>

# Build
npm run build
```

If build fails:
- Record as BLOCKED
- Note the build error
- Move to next issue
- Return to main branch: `git checkout main`

### 3.3 Circuit Electron Testing

Load Circuit Electron tools:

```
ToolSearch: select:mcp__circuit-electron__app_launch
```

Launch in development mode:

```
mcp__circuit-electron__app_launch (
  app: "/Users/angelmarino/Code/prose",
  mode: "development",
  startScript: "dev",
  includeSnapshots: false
)
```

Save the returned `sessionId` for subsequent commands.

#### Read Issue to Understand Acceptance Criteria

Before testing, read the issue body to understand what to test:

```bash
gh issue view <issue_number> --json body,title
```

#### Execute Tests Based on Issue Type

**For UI features:**
- Take screenshot to verify element exists
- Use `evaluate` to test interactions
- Verify expected state changes

**For bug fixes:**
- Attempt to reproduce original bug scenario
- Verify the bug is fixed
- Test edge cases if mentioned in issue

**For settings/persistence:**
- Change setting via UI
- Close app: `mcp__circuit-electron__close`
- Relaunch app
- Verify setting persisted

#### Common Test Patterns

**Take screenshot:**
```
mcp__circuit-electron__screenshot (sessionId: <id>)
```

**Click element by aria-label:**
```
mcp__circuit-electron__evaluate (sessionId: <id>, script: `
  const btn = document.querySelector('[aria-label="Button Name"]');
  btn?.click();
  'clicked'
`)
```

**Get editor content:**
```
mcp__circuit-electron__evaluate (sessionId: <id>, script: `
  document.querySelector('.ProseMirror')?.innerText
`)
```

**Open settings (Cmd+,):**
```
mcp__circuit-electron__evaluate (sessionId: <id>, script: `
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }));
  'triggered'
`)
```

**Verify dialog content:**
```
mcp__circuit-electron__evaluate (sessionId: <id>, script: `
  document.querySelector('[role="dialog"]')?.innerText || 'no dialog'
`)
```

### 3.4 Record Results

For each test, record one of:
- **PASS**: Criteria met, behavior verified
- **FAIL**: Criteria not met, include details of what failed
- **PARTIAL**: Some criteria met, gaps identified
- **BLOCKED**: Cannot test (build failure, missing deps, etc.)

### 3.5 Close Session and Return to Main

```
mcp__circuit-electron__close (sessionId: <id>)
```

```bash
git checkout main
```

## Phase 4: PR Management & Comments

Based on test results and PR state:

### Case A: PR Exists

Comment on existing PR with test results:

```bash
gh pr comment <pr_number> --body "$(cat <<'EOF'
## Automated QA Results

**Issue**: #<issue_number>
**Branch**: `<branch>`
**Tested**: <timestamp>

### Results

| Test | Status | Notes |
|------|--------|-------|
| Build | ✅ | Compiles without errors |
| Launch | ✅ | App starts successfully |
| <Acceptance Criteria 1> | ✅/❌ | <details> |

### Gaps Discovered

- [ ] <Gap 1>
- [ ] <Gap 2>

### Investigation Entry Points

- `<file>:<line>` - <reason>

### Recommendation

✅ **Ready for Review** — All criteria met.
*or*
⚠️ **Needs Work** — Criteria partially met. See gaps above.
*or*
🔴 **Blocked** — Build/test failures. See details above.
EOF
)"
```

### Case B: PR Missing, Tests PASS

Create PR and comment with passing results:

```bash
# Create PR
gh pr create \
  --title "<type>(<scope>): <description> (#<issue>)" \
  --body "$(cat <<'EOF'
## Summary

<Brief description of changes>

Closes #<issue_number>

## Test Plan

- [x] Automated QA passed (see comment below)
EOF
)"

# Update label
gh issue edit <issue_number> --remove-label "accelerated:in-progress" --add-label "accelerated:pr-open"
```

Then comment with passing results:

```bash
gh pr comment <pr_number> --body "$(cat <<'EOF'
## Automated QA Results - PASSING

**Issue**: #<issue_number>
**Branch**: `<branch>`
**Tested**: <timestamp>

### All Tests Passed ✅

| Test | Status |
|------|--------|
| Build | ✅ |
| Launch | ✅ |
| <Acceptance Criteria 1> | ✅ |

### Ready for Human Review

This PR was created by an automated agent and has passed initial QA.
A human reviewer should verify before merging.
EOF
)"
```

### Case C: PR Missing, Tests FAIL

Create draft PR and comment with gaps:

```bash
# Create draft PR
gh pr create \
  --title "<type>(<scope>): <description> (#<issue>)" \
  --body "$(cat <<'EOF'
## Summary

<Brief description of changes>

Closes #<issue_number>

## Status

⚠️ **Draft** — QA found issues that need addressing.
EOF
)" \
  --draft

# Update label
gh issue edit <issue_number> --remove-label "accelerated:in-progress" --add-label "accelerated:pr-open"
```

Then comment with gaps:

```bash
gh pr comment <pr_number> --body "$(cat <<'EOF'
## Automated QA Results - NEEDS WORK

**Issue**: #<issue_number>
**Branch**: `<branch>`
**Tested**: <timestamp>

### Test Results

| Test | Status | Notes |
|------|--------|-------|
| Build | ✅ | |
| Launch | ✅ | |
| <Criteria 1> | ❌ | <what failed> |

### Gaps Discovered

1. **<Gap Title>**
   - Expected: <expected behavior>
   - Actual: <observed behavior>
   - Severity: High/Medium/Low

### Investigation Entry Points

For each gap, potential files to examine:

- `<file>:<line>` - <reason this is relevant>

### Recommendation

🔴 **Draft PR** — Implementation incomplete. Gaps must be addressed before review.
EOF
)"
```

### Case D: Build Failed

If build failed, still create issue comment (not PR):

```bash
gh issue comment <issue_number> --body "$(cat <<'EOF'
## Automated QA Results - BUILD FAILED

**Branch**: `<branch>`
**Tested**: <timestamp>

### Build Error

```
<build error output>
```

### Next Steps

The implementation on this branch does not build. This needs to be fixed before QA can proceed.
EOF
)"
```

## Phase 5: Summary Report

After all issues tested, provide summary to user:

```markdown
## QA Summary for Accelerated Issues

**Tested**: <date>
**Issues**: <total>

### Results

| Issue | Title | Result | PR | Action Taken |
|-------|-------|--------|-----|--------------|
| #38 | Copy buttons | ✅ PASS | #42 | Commented |
| #93 | Feedback | ⚠️ PARTIAL | #45 (draft) | Created draft PR |
| #101 | Theme | ❌ BLOCKED | - | No branch found |

### Statistics

- Passed: <n>
- Partial: <n>
- Failed: <n>
- Blocked: <n>
- Skipped (no branch): <n>

### Human Review Needed

All PRs require human review before merge:
- [ ] PR #42 - Ready for review
- [ ] PR #45 - Needs work (see gaps)

**Reminder**: This skill never auto-merges. All PRs require human approval.
```

## Troubleshooting

### No Accelerated Issues Found

If `gh issue list --label "accelerated"` returns nothing, check:
- Correct repository context
- Labels exist on issues
- Issues are not closed (use `--state all` to include closed)

### Branch Not Found

If no branch matches the pattern:
- Check issue comments for branch name
- Look for PRs that reference the issue
- The issue may not have been worked on yet

### Circuit Electron Issues

- **Snapshot errors**: Always use `includeSnapshots: false`
- **Keyboard tools broken**: Use `evaluate` to dispatch KeyboardEvents
- **Click not working**: Use `evaluate` to click via JavaScript
- **App won't launch**: Try killing stale processes first

### Build Failures

```bash
# Clean and retry
rm -rf out dist node_modules/.cache
npm install
npm run build
```

### GitHub CLI Issues

```bash
# Check authentication
gh auth status

# Ensure correct repo context
gh repo view
```

## Safety Reminders

1. **Never auto-merge**: All PRs require human review
2. **Never force push**: Preserve git history
3. **Return to main**: Always checkout main after testing each branch
4. **Clean processes**: Kill stale Electron processes between tests
