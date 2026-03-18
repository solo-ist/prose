/**
 * Orchestrator: merge scorer + PE signals and route the PR.
 *
 * Reads all PR comments from /tmp/all-comments.txt, extracts the scorer
 * and PE sentinel JSON, applies the routing matrix, and writes:
 *   - /tmp/orchestrator-output.md  (comment to post)
 *   - /tmp/orchestrator-verdict.txt (single word: auto-fix|hitl-light|hitl-full)
 *
 * Environment variables:
 *   PR_NUMBER - Pull request number
 *   REPO      - Repository (owner/name)
 */

import { readFileSync, writeFileSync } from 'node:fs'

const { PR_NUMBER, REPO } = process.env

// ---------------------------------------------------------------------------
// Parse sentinel JSON from comments
// ---------------------------------------------------------------------------

const comments = readFileSync('/tmp/all-comments.txt', 'utf-8')

function parseSentinel(prefix, text) {
  const re = new RegExp(`<!-- ${prefix}: (\\{.*?\\}) -->`, 'g')
  const matches = [...text.matchAll(re)]
  if (matches.length === 0) return null
  const m = matches[matches.length - 1]
  try {
    return JSON.parse(m[1])
  } catch {
    console.error(`Failed to parse ${prefix} sentinel: ${m[1]}`)
    return null
  }
}

const scorer = parseSentinel('scorer-output', comments)
const pe = parseSentinel('pe-output', comments)

if (!scorer) {
  console.error('Scorer output sentinel not found in PR comments')
  process.exit(1)
}
if (!pe) {
  console.error('PE output sentinel not found in PR comments')
  process.exit(1)
}

console.log(`Scorer: score=${scorer.score}, threshold=${scorer.threshold}`)
console.log(`PE: risk=${pe.risk}, privileged=${pe.privileged}, concerns=${pe.concerns}`)

// ---------------------------------------------------------------------------
// Routing matrix
// ---------------------------------------------------------------------------

function route(score, risk, privileged) {
  // Security hard gate: CRITICAL risk or privileged paths always escalate
  if (risk === 'CRITICAL' || privileged) {
    return 'hitl-full'
  }

  // High complexity always needs full review
  if (score >= 7) {
    return 'hitl-full'
  }

  // Medium score range
  if (score >= 4) {
    return risk === 'LOW' ? 'auto-fix-verify' : 'hitl-full'
  }

  // Low score range (1-3)
  return risk === 'LOW' ? 'auto-fix' : 'hitl-light'
}

const verdict = route(scorer.score, pe.risk, pe.privileged)

console.log(`Verdict: ${verdict}`)

// ---------------------------------------------------------------------------
// Labels to apply
// ---------------------------------------------------------------------------

const labelMap = {
  'auto-fix': 'auto-fix-queued',
  'auto-fix-verify': 'auto-fix-queued,needs-review',
  'hitl-light': 'needs-review',
  'hitl-full': 'complex,needs-review',
}

const labels = labelMap[verdict] || 'needs-review'

// ---------------------------------------------------------------------------
// Build output
// ---------------------------------------------------------------------------

const routeDescriptions = {
  'auto-fix': 'Automated fix — Claude Code will attempt to push a fix commit.',
  'auto-fix-verify': 'Automated fix with verification — Claude Code will push a fix, then human reviews.',
  'hitl-light': 'Light human review — analyses posted, awaiting human verification.',
  'hitl-full': 'Full human review — complex or high-risk changes require human attention.',
}

const securityNote = pe.privileged
  ? '\n> **[SECURITY GATE]** This PR touches privilege-boundary files and requires human review.\n'
  : ''

const criticalNote = pe.risk === 'CRITICAL'
  ? '\n> **[CRITICAL RISK]** PE analysis flagged critical architectural risk.\n'
  : ''

const output = `<!-- orchestrator-verdict: ${verdict} -->
## Pipeline Verdict: PR #${PR_NUMBER}

**Route: ${verdict.toUpperCase()}** — ${routeDescriptions[verdict]}
${securityNote}${criticalNote}
### Signals

| Signal | Value | Detail |
|--------|-------|--------|
| Scorer | **${scorer.score}/10** | Threshold: ${scorer.threshold} |
| PE Risk | **${pe.risk}** | Concerns: ${pe.concerns} |
| Privileged | ${pe.privileged ? 'Yes' : 'No'} | ${pe.privileged ? 'Touches privilege-boundary files' : 'No privilege-boundary files changed'} |

### Routing Rationale

- Scorer threshold: \`${scorer.threshold}\` (score ${scorer.score}/10)
- PE risk level: \`${pe.risk}\` with ${pe.concerns} concern(s)
${pe.privileged ? '- **Security gate triggered** — privilege-boundary files detected\n' : ''}- Applied labels: \`${labels}\`

---
*Pipeline triage complete. ${verdict === 'auto-fix' || verdict === 'auto-fix-verify' ? 'Auto-fix workflow will be triggered.' : 'Awaiting human action.'}*
`

writeFileSync('/tmp/orchestrator-output.md', output, 'utf-8')
writeFileSync('/tmp/orchestrator-verdict.txt', verdict, 'utf-8')
console.log('Orchestrator output written to /tmp/orchestrator-output.md')
console.log(`Verdict "${verdict}" written to /tmp/orchestrator-verdict.txt`)
