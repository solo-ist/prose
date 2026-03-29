# Sentry Debug

Investigate and fix production errors reported to Sentry using the Sentry CLI.

## Usage

```
/sentry-debug [issue-id]
```

- `/sentry-debug` — list recent unresolved issues, then investigate the most relevant one
- `/sentry-debug PROSE-4` — investigate a specific issue by short ID

## Prerequisites

- Sentry CLI authenticated: `npx sentry auth login`
- Sentry SDK integrated in the app (already done — `@sentry/electron`)

## Workflow

### 1. Discovery

If no issue ID provided, list recent unresolved issues:

```bash
npx sentry issue list --json
```

Present the issues to the user as a table: short ID, title, priority, last seen, event count. Ask which one to investigate, or pick the most recent/highest priority.

### 2. Root Cause Analysis

Run Seer AI analysis on the target issue:

```bash
npx sentry issue explain <short-id>
```

This takes ~1 minute. It returns:
- Reproduction steps with breadcrumb analysis
- Suspect code lines with inline annotations
- Root cause hypothesis

**Treat Seer output as a strong lead, not gospel.** Always cross-reference against the actual source code.

### 3. Code Investigation

Using the suspect file/function from Seer's analysis:

1. **Read the actual source file** — verify the suspect line exists and matches the stack trace
2. **Trace the data flow** — follow variables through scopes, closures, and async boundaries
3. **Check for scope issues** — common in callbacks, closures, and async/await (like the `csrfState` bug: variable declared in one closure but referenced from a sibling scope)
4. **Look for similar patterns** — if the bug is a pattern (e.g., missing error handling), grep for other instances

### 4. Fix

Implement the fix. Common patterns:
- **Scope bugs**: hoist variable declarations to the enclosing scope
- **Undefined access**: add null checks or validate inputs before access
- **Async race conditions**: ensure state is set before callbacks that read it
- **Missing error boundaries**: wrap in try/catch with proper error propagation

### 5. Verify

After fixing:

1. Confirm the fix addresses the exact error condition from Sentry
2. Check for similar patterns elsewhere in the codebase
3. If possible, reproduce the original trigger and confirm the error no longer occurs

### 6. Resolve (optional)

If the user confirms the fix:

```bash
npx sentry issue plan <short-id>   # Optional: compare your fix to Sentry's suggested plan
```

## Output Format

Present findings as:

```
## PROSE-<id>: <title>

**Sentry:** <permalink>
**Priority:** <priority> | **Events:** <count> | **Last seen:** <timestamp>

### Root Cause
<1-2 sentence summary from Seer + your code analysis>

### Fix
<what was changed and why>

### Files Modified
- `path/to/file.ts:line` — description of change
```
