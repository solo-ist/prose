#!/usr/bin/env bash
# validate-pipeline.sh — verify pipeline bug fixes for issue #327
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

# 5. auto-fix-verify verdict exists in orchestrator
echo "--- Check: auto-fix-verify verdict ---"
if grep -q "auto-fix-verify" .github/scripts/run-orchestrator.mjs; then
  echo "PASS"
else
  echo "FAIL: auto-fix-verify not found in orchestrator"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 6. dotAll flag on parseSentinel regex
echo "--- Check: parseSentinel dotAll flag ---"
if grep -q "'s'" .github/scripts/run-orchestrator.mjs; then
  echo "PASS"
else
  echo "FAIL: parseSentinel regex missing dotAll flag"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 7. PIPELINE_CONTEXT env var in pipeline-fix.yml
echo "--- Check: PIPELINE_CONTEXT env injection ---"
if grep -q "PIPELINE_CONTEXT" .github/workflows/pipeline-fix.yml; then
  echo "PASS"
else
  echo "FAIL: PIPELINE_CONTEXT not found in pipeline-fix.yml"
  ERRORS=$((ERRORS + 1))
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

# 10. JS syntax check
echo "--- Check: JS syntax ---"
JS_OK=true
for f in .github/scripts/*.mjs; do
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

# 11. YAML syntax check (requires npx js-yaml or similar)
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

# Summary
echo "==========================="
if [ "$ERRORS" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "FAILED: $ERRORS check(s) failed"
  exit 1
fi
