#!/usr/bin/env bash
# PostToolUse hook: doc-check.sh
#
# Fires after every Bash tool use. When the command was a git commit,
# reviews the changed files and prompts Claude to update CLAUDE.md or
# skill files if the changes affect documented architecture.

set -euo pipefail

# Read the full PostToolUse JSON payload from stdin
INPUT="$(cat)"

# Fast path: only care about git commit commands
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')"

# Exit immediately for non-commit commands (fast path)
if ! printf '%s' "$COMMAND" | grep -q 'git commit'; then
  exit 0
fi

# Guard: if the most recent commit message starts with docs( or docs:,
# this is a documentation follow-up — skip to prevent an infinite loop.
LAST_MSG="$(git log -1 --format='%s' 2>/dev/null || true)"
if printf '%s' "$LAST_MSG" | grep -qE '^docs(\(|:)'; then
  exit 0
fi

# Get changed files from the commit we just made.
# HEAD~1 may not exist on the very first commit — handle gracefully.
DIFF_OUTPUT="$(git diff HEAD~1 --name-status 2>/dev/null || git diff --root HEAD --name-status 2>/dev/null || true)"

if [ -z "$DIFF_OUTPUT" ]; then
  DIFF_OUTPUT="(could not determine changed files)"
fi

# Emit a block decision so Claude pauses and reviews the diff.
REASON="A commit was just made. Review the changed files and determine if CLAUDE.md or any skill files (.claude/skills/) need updating to reflect these changes. If documentation updates are needed, make the edits and create a follow-up commit with conventional commit type 'docs'. If no updates are needed, say so and proceed.

Changed files:
${DIFF_OUTPUT}"

jq -n --arg reason "$REASON" '{"decision": "block", "reason": $reason}'
