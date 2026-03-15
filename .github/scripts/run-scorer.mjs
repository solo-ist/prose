/**
 * Score PR review findings using a quantitative rubric.
 *
 * Reads a review comment from /tmp/review-comment.txt, sends it to the
 * Anthropic API for rubric-based scoring, and writes structured output to
 * /tmp/scorer-output.md.
 *
 * Scores 6 dimensions (1-5 each), computes a composite score on a 1-10 scale,
 * and maps to a routing threshold (auto-fix / review / complex).
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY - Anthropic API key
 *   PR_NUMBER         - Pull request number
 *   REPO              - Repository (owner/name)
 */

import { readFileSync, writeFileSync } from 'node:fs'

const { ANTHROPIC_API_KEY, PR_NUMBER, REPO } = process.env

if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required')
  process.exit(1)
}

const reviewComment = readFileSync('/tmp/review-comment.txt', 'utf-8').trim()

if (!reviewComment) {
  console.error('No review comment found. Run /review first to generate one, then /triage to re-analyze.')
  process.exit(1)
}

const systemPrompt = `You are a precise code review analyst that scores PR review findings using a quantitative rubric. You output structured JSON data embedded in markdown.

Your job is to evaluate how complex and risky a set of review findings are, using a consistent 6-dimension rubric. Be objective and calibrated — most PRs should score in the middle range (4-6). Reserve extremes for genuinely trivial or genuinely dangerous changes.`

const userPrompt = `Score this code review for PR #${PR_NUMBER} in ${REPO} using the 6-dimension rubric below.

<review>
${reviewComment}
</review>

## Rubric

Score each dimension 1-5:

| Dimension | 1 (Low) | 3 (Medium) | 5 (High) |
|-----------|---------|------------|----------|
| **scope** | 1-2 files changed | 3-5 files across 1-2 systems | Cross-cutting changes across many systems |
| **severity_mix** | Style/nitpicks only | Mix of style and functional bugs | Security vulnerabilities or data-loss risks |
| **change_type** | Config/docs/copy | Feature addition or bug fix | Core architecture or foundational changes |
| **test_impact** | No test impact | Tests updated or added | Critical paths with no test coverage |
| **api_surface** | Internal implementation only | Internal API changes | Breaking public API or interface changes |
| **dependency_risk** | No dependency changes | Minor dep update | New major dep, removed dep, or version overhaul |

## Output Format

Respond with EXACTLY this markdown. Fill in the values — do not add extra sections.

## Scorer Output: PR #${PR_NUMBER}

### Dimension Scores

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Scope | N/5 | <one sentence> |
| Severity mix | N/5 | <one sentence> |
| Change type | N/5 | <one sentence> |
| Test impact | N/5 | <one sentence> |
| API surface | N/5 | <one sentence> |
| Dependency risk | N/5 | <one sentence> |

### Composite Score

**Score: N/10** — <threshold label>

<1-2 sentence summary of the overall routing rationale>

<!-- scorer-output: {"score":COMPOSITE,"dimensions":{"scope":N,"severity_mix":N,"change_type":N,"test_impact":N,"api_surface":N,"dependency_risk":N},"threshold":"THRESHOLD"} -->

Where:
- COMPOSITE = average of 6 dimension scores × 2, rounded to one decimal place
- THRESHOLD = "auto-fix" if score <= 3, "review" if score <= 6, "complex" if score >= 7`

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  }),
})

if (!response.ok) {
  console.error(`Anthropic API error: ${response.status} ${response.statusText}`)
  process.exit(1)
}

const data = await response.json()

if (!data.content?.[0]?.text) {
  console.error(`Unexpected API response structure: ${JSON.stringify(data).substring(0, 200)}`)
  process.exit(1)
}

const analysis = data.content[0].text

// Prepend sentinel marker (invisible in rendered markdown) to prevent loop
const output = `<!-- scorer-output-comment -->\n${analysis}`

writeFileSync('/tmp/scorer-output.md', output, 'utf-8')
console.log('Scorer output written to /tmp/scorer-output.md')
