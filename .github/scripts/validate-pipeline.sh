#!/usr/bin/env bash
# validate-pipeline.sh — verify pipeline invariants
set -euo pipefail

ERRORS=0

echo "=== Pipeline Validation ==="
echo ""

# 1. No checkout@v5 in workflows
echo "--- Check: No actions/checkout@v5 ---"
if grep -r "checkout@v5" .github/workflows/; then
  echo "FAIL: Found checkout@v5 references"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS"
fi
echo ""

# 2. No stale model IDs in scripts
echo "--- Check: No stale model IDs ---"
if grep -rE "claude-sonnet-4-5|claude-opus-4-2" .github/scripts/ --include='*.mjs'; then
  echo "FAIL: Found stale model IDs"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS"
fi
echo ""

# 3. PE max_tokens >= 8192
echo "--- Check: PE max_tokens >= 8192 ---"
if grep -q "max_tokens: 8192" .github/scripts/run-pe-analysis.mjs; then
  echo "PASS"
else
  echo "FAIL: PE max_tokens not set to 8192"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 4. PE sentinel exists
echo "--- Check: PE loop-prevention sentinel ---"
if grep -q "pe-output-comment" .github/scripts/run-pe-analysis.mjs; then
  echo "PASS"
else
  echo "FAIL: PE output missing loop-prevention sentinel"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 5. auto-fix retired: orchestrator must NOT contain auto-fix and MUST contain hitl-light + hitl-full
echo "--- Check: auto-fix retired in orchestrator (#737) ---"
AUTOFIX_OK=true
if grep -q "auto-fix" .github/scripts/run-orchestrator.mjs; then
  echo "FAIL: run-orchestrator.mjs still contains 'auto-fix' (should be retired per #737)"
  AUTOFIX_OK=false
  ERRORS=$((ERRORS + 1))
fi
if ! grep -q "hitl-light" .github/scripts/run-orchestrator.mjs; then
  echo "FAIL: run-orchestrator.mjs missing 'hitl-light' verdict"
  AUTOFIX_OK=false
  ERRORS=$((ERRORS + 1))
fi
if ! grep -q "hitl-full" .github/scripts/run-orchestrator.mjs; then
  echo "FAIL: run-orchestrator.mjs missing 'hitl-full' verdict"
  AUTOFIX_OK=false
  ERRORS=$((ERRORS + 1))
fi
if $AUTOFIX_OK; then
  echo "PASS"
fi
echo ""

# 6. parseSentinel uses matchAll (not single match with dotAll)
echo "--- Check: parseSentinel uses matchAll ---"
if grep -q "matchAll" .github/scripts/run-orchestrator.mjs; then
  echo "PASS"
else
  echo "FAIL: parseSentinel should use matchAll for last-match semantics"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 7. pipeline-fix.yml must NOT exist (retired per #737)
echo "--- Check: pipeline-fix.yml does not exist (#737) ---"
if [ -f ".github/workflows/pipeline-fix.yml" ]; then
  echo "FAIL: .github/workflows/pipeline-fix.yml still exists (retired per #737)"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS"
fi
echo ""

# 8. orchestrate job has success guard
echo "--- Check: orchestrate job success guard ---"
if grep -q "needs.run-scorer.result" .github/workflows/pipeline-triage.yml; then
  echo "PASS"
else
  echo "FAIL: orchestrate job missing success guard"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 9. Label creation step exists
echo "--- Check: label creation step ---"
if grep -q "gh label create" .github/workflows/pipeline-triage.yml; then
  echo "PASS"
else
  echo "FAIL: label creation step not found"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 10. retry.mjs exists
echo "--- Check: retry utility exists ---"
if [ -f ".github/scripts/lib/retry.mjs" ]; then
  echo "PASS"
else
  echo "FAIL: .github/scripts/lib/retry.mjs not found"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 11. All API scripts use withRetry
echo "--- Check: API scripts use retry ---"
RETRY_OK=true
for f in .github/scripts/run-scorer.mjs .github/scripts/run-pe-analysis.mjs .github/scripts/analyze-review-feedback.mjs; do
  if ! grep -q "withRetry" "$f"; then
    echo "FAIL: $f does not use withRetry"
    RETRY_OK=false
    ERRORS=$((ERRORS + 1))
  fi
done
if $RETRY_OK; then
  echo "PASS"
fi
echo ""

# 12. Model env var overrides exist
echo "--- Check: Model env var overrides ---"
MODEL_OK=true
if ! grep -q "SCORER_MODEL" .github/scripts/run-scorer.mjs; then
  echo "FAIL: SCORER_MODEL override missing in run-scorer.mjs"
  MODEL_OK=false
  ERRORS=$((ERRORS + 1))
fi
if ! grep -q "PE_MODEL" .github/scripts/run-pe-analysis.mjs; then
  echo "FAIL: PE_MODEL override missing in run-pe-analysis.mjs"
  MODEL_OK=false
  ERRORS=$((ERRORS + 1))
fi
if ! grep -q "FEEDBACK_MODEL" .github/scripts/analyze-review-feedback.mjs; then
  echo "FAIL: FEEDBACK_MODEL override missing in analyze-review-feedback.mjs"
  MODEL_OK=false
  ERRORS=$((ERRORS + 1))
fi
if $MODEL_OK; then
  echo "PASS"
fi
echo ""

# 13. No id-token: write in workflows that don't need it
# claude.yml legitimately needs id-token: write for
# claude-code-action's OIDC token exchange — skip it.
echo "--- Check: No unnecessary id-token: write ---"
IDTOKEN_OK=true
for f in .github/workflows/*.yml; do
  case "$(basename "$f")" in
    claude.yml) continue ;;
  esac
  if grep -q "id-token: write" "$f"; then
    echo "FAIL: $f has unnecessary id-token: write permission"
    IDTOKEN_OK=false
    ERRORS=$((ERRORS + 1))
  fi
done
if $IDTOKEN_OK; then
  echo "PASS"
fi
echo ""

# 14. dispatch.yml has loop-prevention sentinel
echo "--- Check: dispatch.yml loop sentinel ---"
if grep -q "dispatch-generated" .github/workflows/dispatch.yml; then
  echo "PASS"
else
  echo "FAIL: dispatch.yml missing dispatch-generated sentinel"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 15. pipeline-triage.yml must NOT dispatch pipeline-fix.yml (retired per #737)
echo "--- Check: No pipeline-fix dispatch in pipeline-triage (#737) ---"
if grep -q "gh workflow run pipeline-fix.yml" .github/workflows/pipeline-triage.yml; then
  echo "FAIL: pipeline-triage.yml still dispatches pipeline-fix.yml (retired per #737)"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS"
fi
echo ""

# 16. JS syntax check (includes lib/)
echo "--- Check: JS syntax ---"
JS_OK=true
for f in $(find .github/scripts -name '*.mjs'); do
  if ! node --check "$f" 2>/dev/null; then
    echo "FAIL: Syntax error in $f"
    JS_OK=false
    ERRORS=$((ERRORS + 1))
  fi
done
if $JS_OK; then
  echo "PASS"
fi
echo ""

# 17. YAML syntax check
echo "--- Check: YAML syntax ---"
YAML_OK=true
for f in .github/workflows/*.yml; do
  if ! npx --yes js-yaml "$f" > /dev/null 2>&1; then
    echo "FAIL: YAML syntax error in $f"
    YAML_OK=false
    ERRORS=$((ERRORS + 1))
  fi
done
if $YAML_OK; then
  echo "PASS"
fi
echo ""

# 18. ci-gate.yml must NOT contain @claude (e2e path must not request an automated fix)
echo "--- Check: ci-gate.yml has no @claude mention (#737) ---"
if grep -q "@claude" .github/workflows/ci-gate.yml; then
  echo "FAIL: ci-gate.yml contains '@claude' — e2e failure path must not request automated fix"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS"
fi
echo ""

# 19. Security-gate sentinel sync (#395)
# claude.yml emits `<!-- security-gate: true -->` and pipeline-triage.yml
# greps for the same sentinel. If either side drifts, the short-circuit
# silently breaks and privilege-boundary PRs waste API calls on scorer+PE.
echo "--- Check: Security-gate sentinel sync ---"
SENTINEL_SYNC_OK=true
for f in .github/workflows/claude.yml .github/workflows/pipeline-triage.yml; do
  if ! grep -q "security-gate: true" "$f"; then
    echo "FAIL: $f does not reference the 'security-gate: true' sentinel"
    SENTINEL_SYNC_OK=false
    ERRORS=$((ERRORS + 1))
  fi
done
if $SENTINEL_SYNC_OK; then
  echo "PASS"
fi
echo ""

# 20. Privilege-boundary path sync (383-7)
# The path list must be identical in claude.yml and run-pe-analysis.mjs
echo "--- Check: Privilege-boundary path sync ---"
PATHS_CLAUDE=$(grep -oE 'src/main/\*\*|src/preload/\*\*|electron-builder\.\*|electron\.vite\.config\.\*' .github/workflows/claude.yml | sort -u)
PATHS_PE=$(grep -oE 'src/main/\*\*|src/preload/\*\*|electron-builder\.\*|electron\.vite\.config\.\*' .github/scripts/run-pe-analysis.mjs | sort -u)
if [ "$PATHS_CLAUDE" = "$PATHS_PE" ]; then
  echo "PASS"
else
  echo "FAIL: Privilege-boundary paths diverge between claude.yml and run-pe-analysis.mjs"
  echo "  claude.yml: $PATHS_CLAUDE"
  echo "  run-pe-analysis.mjs: $PATHS_PE"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 21. claude.yml retains the runtime permission gate (#726)
# author_association is unreliable (GITHUB_TOKEN can't see private org membership),
# so trust is enforced by the runtime getCollaboratorPermissionLevel step, not an if:.
echo "--- Check: claude.yml runtime permission gate ---"
if grep -q "getCollaboratorPermissionLevel" .github/workflows/claude.yml; then
  echo "PASS"
else
  echo "FAIL: claude.yml missing runtime getCollaboratorPermissionLevel trust gate"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 22. ci-gate PR-author trust gate before posting /review (#726)
# trigger-review must check the PR author's effective permission (NOT author_association)
# before the Anthropic-spending review.
echo "--- Check: ci-gate PR-author trust gate ---"
CI_GATE_TRUST_OK=true
if ! grep -q "steps.trust.outputs.trusted" .github/workflows/ci-gate.yml; then
  echo "FAIL: ci-gate.yml missing steps.trust.outputs.trusted gate on Trigger auto-review"
  CI_GATE_TRUST_OK=false
  ERRORS=$((ERRORS + 1))
fi
if ! grep -q "getCollaboratorPermissionLevel" .github/workflows/ci-gate.yml; then
  echo "FAIL: ci-gate.yml trust step must use getCollaboratorPermissionLevel (not author_association)"
  CI_GATE_TRUST_OK=false
  ERRORS=$((ERRORS + 1))
fi
if $CI_GATE_TRUST_OK; then
  echo "PASS"
fi
echo ""

# 23. dispatch.yml must NOT reference pipeline-fix.yml (retired per #737)
echo "--- Check: dispatch.yml has no pipeline-fix.yml reference (#737) ---"
if grep -q "pipeline-fix.yml" .github/workflows/dispatch.yml; then
  echo "FAIL: dispatch.yml still references pipeline-fix.yml (retired per #737)"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS"
fi
echo ""

# Summary
echo "==========================="
if [ "$ERRORS" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "FAILED: $ERRORS check(s) failed"
  exit 1
fi
