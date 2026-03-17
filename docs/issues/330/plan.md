# Issue #330: Self-Healing Documentation Hook

## Approach

Replaces the original 5-phase CI pipeline design with a lightweight local hook. Instead of a GitHub Actions workflow, a `PostToolUse` shell hook fires inside Claude Code after every Bash call. When the command was a `git commit`, the hook reviews the changed files and blocks Claude to prompt a documentation review.

This approach is simpler, faster, and runs entirely locally — no network round-trips, no workflow dispatch latency.

## Files Created

| File | Purpose |
|---|---|
| `.claude/hooks/doc-check.sh` | PostToolUse hook script |
| `.claude/settings.json` | Hooks configuration merged with existing permissions |
| `docs/issues/330/plan.md` | This plan document |

## How the Hook Works

```
PostToolUse fires (every Bash call)
        |
        v
Parse tool_input.command via jq
        |
        +-- Not "git commit"? --> exit 0 (fast path, no-op)
        |
        v
Check last commit message
        |
        +-- Starts with "docs(" or "docs:"? --> exit 0 (prevent loop)
        |
        v
Run git diff HEAD~1 --name-status
        |
        +-- Initial commit (HEAD~1 fails)? --> use --root fallback
        |
        v
Emit JSON: {"decision": "block", "reason": "...changed files..."}
        |
        v
Claude pauses and reviews the diff
        |
        +-- Docs need updating? --> edit files + commit with "docs(...):"
        |
        +-- No update needed?  --> say so and continue
```

## Edge Cases Handled

- **Non-commit Bash commands**: Fast path exits immediately after a single `jq` parse + `grep`. Minimal overhead on every Bash call.
- **Docs commits**: If `git log -1` shows a message starting with `docs(` or `docs:`, the hook exits 0. Prevents the hook from re-triggering on its own follow-up commit.
- **Initial commit**: `HEAD~1` does not exist when there is only one commit. Falls back to `git diff --root HEAD --name-status`. If both fail, emits a placeholder message rather than crashing.
- **Empty diff**: If diff output is empty for any reason, a safe placeholder string is substituted so the JSON payload is always valid.
- **jq safety**: The reason string is passed through `jq -n --arg` to ensure proper JSON escaping of newlines and special characters.

## Why "block" vs "ask"

The `"block"` decision halts the current tool loop and surfaces the prompt to Claude immediately. This is the correct choice here because documentation review should happen before Claude continues with the next task, not be deferred to a background notification.
