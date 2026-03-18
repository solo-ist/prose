/**
 * Analyze PR review feedback from Claude bot.
 *
 * Reads a review comment from /tmp/review-comment.txt, sends it to the
 * Anthropic API for categorization, and writes structured analysis to
 * /tmp/analysis-output.md.
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
  console.error('No review comment found')
  process.exit(1)
}

const systemPrompt = `You are a pragmatic code review analyst. You analyze code review feedback and provide structured, actionable recommendations.

Your philosophy: pragmatism over compliance. Ship quality code, not perfect code. Validate that issues are real, weigh effort vs impact, and recommend deferring low-priority issues to follow-up tickets.`

const userPrompt = `Analyze this code review feedback for PR #${PR_NUMBER} in ${REPO}.

<review>
${reviewComment}
</review>

Categorize each piece of feedback into:
- **Blocking**: Security vulnerabilities, crashes, data loss
- **Functional**: Bugs, broken features, edge case failures
- **Code Quality**: Style, patterns, maintainability
- **Nitpicks**: Preferences, minor suggestions, formatting
- **Questions**: Clarifications, not actionable

For each item, assess:
- **Severity**: Critical / High / Medium / Low
- **Effort**: Quick fix (< 5 min) / Moderate (< 30 min) / Significant refactor

Then provide a recommendation:
- **MERGE** — no blocking issues, remaining feedback is cosmetic or out-of-scope
- **FIX REQUIRED** — blocking issues exist (security, crashes) or functional bugs affect users
- **NEEDS DISCUSSION** — significant architectural concerns or scope disagreement

Output EXACTLY this markdown format. Omit any section that has zero items:

## Review Feedback Analysis: #${PR_NUMBER}

### Summary
<1-2 sentence overview of the review and your recommendation>

### Recommendation: [MERGE | FIX REQUIRED | NEEDS DISCUSSION]

---

### Must Fix Before Merge
| Issue | Category | Severity | Effort | Rationale |
|-------|----------|----------|--------|-----------|

### Consider Fixing
| Issue | Category | Severity | Effort | Recommendation |
|-------|----------|----------|--------|----------------|

### Defer to Follow-up
| Issue | Rationale |
|-------|-----------|

### Dismissed
| Feedback | Reason |
|----------|--------|

---
*Automated triage — for code-level validation, run \`/review-feedback ${PR_NUMBER}\` locally.*`

import { withRetry } from './lib/retry.mjs'

const data = await withRetry(async () => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.FEEDBACK_MODEL || 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}, {
  maxRetries: 3,
  onRetry: (attempt, err, delay) =>
    console.warn(`Retry ${attempt}/3 after ${delay}ms: ${err.message}`)
})

if (!data.content?.[0]?.text) {
  console.error(`Unexpected API response structure: ${JSON.stringify(data).substring(0, 200)}`)
  process.exit(1)
}

const analysis = data.content[0].text

// Prepend sentinel marker (invisible in rendered markdown) to prevent loop
const output = `<!-- review-feedback-analysis -->\n${analysis}`

writeFileSync('/tmp/analysis-output.md', output, 'utf-8')
console.log('Analysis written to /tmp/analysis-output.md')
