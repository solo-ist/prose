---
name: review-prs
description: Batch review and process all open PRs from Claude Code agents. Use when the user wants to review, test, and merge multiple PRs efficiently.
---

# Review PRs

Batch process all open PRs in solo-ist/prose - review, test, fix, and merge.

## Usage

```
/review-prs
```

## Workflow

### 1. Fetch All Open PRs

```
mcp__github__list_pull_requests (owner: "solo-ist", repo: "prose", state: "open")
```

### 2. For Each PR, Gather Context

```
mcp__github__pull_request_read (method: "get", owner: "solo-ist", repo: "prose", pullNumber: <n>)
mcp__github__pull_request_read (method: "get_diff", owner: "solo-ist", repo: "prose", pullNumber: <n>)
mcp__github__pull_request_read (method: "get_comments", owner: "solo-ist", repo: "prose", pullNumber: <n>)
```

### 3. Prioritize and Order

Order PRs by:
1. **Merge conflicts** - skip or rebase
2. **Size** - smaller PRs first (faster wins)
3. **Dependencies** - if PR B depends on PR A, do A first
4. **Age** - older PRs first

### 4. Review Each PR

For each PR, assess:

**Redundancy Check:**
- Compare changes against current main
- If feature already exists in main, close PR with explanation
- Use Grep/Read to check if similar code exists

**Code Review:**
- Check for bugs, regressions, security issues
- Verify code follows existing patterns
- Look for incomplete implementations

**Decision Tree:**
- ✅ **Good to merge**: Test with Circuit Electron, then merge
- 🔧 **Fixable issues**: Checkout branch, fix, push, then test
- 🚫 **Redundant**: Close PR with explanation
- ⚠️ **Needs human**: Comment and skip

### 5. Fix Issues (When Feasible)

If issues are fixable:

```bash
git fetch origin <branch>
git checkout <branch>
# Make fixes
git add . && git commit -m "fix: <description>"
git push origin <branch>
```

### 6. Test with Circuit Electron

Before merging, test the PR:

```bash
# Kill stale processes
pkill -f "Electron.app" 2>/dev/null
pkill -f "electron-vite" 2>/dev/null

# Build fresh
npm run build
```

```
mcp__circuit-electron__app_launch (app: "/Users/angelmarino/Code/prose", mode: "development", startScript: "dev", includeSnapshots: false)
```

Verify the feature works:
- Use `evaluate` to interact with the app
- Use `text_content` to verify state
- Use `screenshot` if visual verification needed

### 7. Merge or Report

**If tests pass:**
```
mcp__github__merge_pull_request (owner: "solo-ist", repo: "prose", pullNumber: <n>, merge_method: "squash")
```

**If issues found:**
```
mcp__github__add_issue_comment (owner: "solo-ist", repo: "prose", issue_number: <n>, body: "## Review Findings\n\n...")
```

### 8. Parallel Processing

For independent PRs, use Task tool to spawn subagents:

```
Task (subagent_type: "general-purpose", prompt: "Review and test PR #X for solo-ist/prose...")
```

Run up to 3 PRs in parallel when they don't have dependencies.

## Key Principles

1. **Bias toward action** - Fix issues directly, don't just comment
2. **Detect redundancy** - Close PRs for features that already exist
3. **Test everything** - Use Circuit Electron before merging
4. **Clean up** - Close stale branches, update related issues
5. **Report clearly** - Comment results on each PR

## Result Format

After processing all PRs, report:

```markdown
## PR Review Summary

| PR | Title | Action | Notes |
|----|-------|--------|-------|
| #81 | Context menu | ✅ Merged | Tested with Circuit |
| #60 | Feature X | 🚫 Closed | Redundant with main |
| #42 | Bug fix | 🔧 Fixed & Merged | Fixed linting error |
| #33 | Refactor | ⚠️ Needs Human | Architectural decision |
```

## Troubleshooting

- **Merge conflicts**: Attempt rebase, if complex, skip and comment
- **Circuit Electron fails**: Fall back to manual build + dev server
- **Tests fail**: Comment findings, don't merge
