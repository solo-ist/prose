/**
 * Principal Engineer architectural risk analysis for PR changes.
 *
 * Reads review feedback and changed files, sends to Claude Opus with a
 * cantankerous-but-constructive PE persona, and writes structured analysis
 * to /tmp/pe-output.md.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY - Anthropic API key
 *   PR_NUMBER         - Pull request number
 *   REPO              - Repository (owner/name)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

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

// Changed files are optional — PE can still analyze based on the review comment alone
let changedFiles = ''
if (existsSync('/tmp/changed-files.txt')) {
  changedFiles = readFileSync('/tmp/changed-files.txt', 'utf-8').trim()
  if (changedFiles) {
    console.log('Changed files loaded for privilege boundary detection')
  } else {
    console.warn('Warning: /tmp/changed-files.txt exists but is empty — analyzing from review comment only')
  }
} else {
  console.warn('Warning: /tmp/changed-files.txt not found — analyzing from review comment only')
}

const systemPrompt = `You are a principal engineer reviewing code changes. You are cantankerous but constructive — you've seen enough production incidents to know where the bodies are buried. You care deeply about:

- Architectural coherence: Does this change fit the system's design, or is it duct tape?
- Blast radius: If this breaks, what else breaks with it?
- Root cause vs symptom: Is this fixing the real problem or papering over it?
- Tech debt trajectory: Does this make the codebase better or worse to work in next quarter?
- Hidden coupling: What implicit contracts does this create or break?

For Electron apps specifically, you watch for:
- Process boundary violations (renderer reaching into main, or vice versa without IPC)
- Context bridge exposure (new APIs exposed through preload without validation)
- getApi() abstraction bypasses (direct window.api access instead of getApi())
- IPC handler input validation gaps
- Zustand store interaction patterns (cross-store dependencies, missing subscriptions)`

const userPrompt = `Review these changes for PR #${PR_NUMBER} in ${REPO}.

<review-findings>
${reviewComment}
</review-findings>

<changed-files>
${changedFiles || '(not available — analyze from review findings only)'}
</changed-files>

Analyze the architectural risk of these changes. For each concern, explain:
1. What the risk is
2. What could go wrong in production
3. How severe the impact would be

Determine the PRIVILEGE boundary status:
- Set "privileged": true if ANY changed file matches: src/main/**, src/preload/**, electron-builder.*, electron.vite.config.* (NOTE: this list is duplicated in claude.yml review prompt — keep both in sync)
- Set "privileged": false otherwise

Rate the overall risk as exactly one of: LOW, MEDIUM, HIGH, CRITICAL

Output your analysis in this format:

## Principal Engineer Analysis: PR #${PR_NUMBER}

### Risk Assessment: [LOW|MEDIUM|HIGH|CRITICAL]
### Privilege Boundary: [CLEAR|FLAGGED]

### Architecture Review
<your detailed analysis>

### Concerns
<numbered list of specific concerns with severity>

### Verdict
<1-2 sentence summary of your recommendation>

At the very end, on its own line, include this machine-readable sentinel:
<!-- pe-output: {"risk":"LOW|MEDIUM|HIGH|CRITICAL","privileged":true|false,"concerns":N} -->

Where N is the count of concerns listed.`

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
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
const output = `<!-- pe-output-comment -->\n${analysis}`

writeFileSync('/tmp/pe-output.md', output, 'utf-8')
console.log('PE analysis written to /tmp/pe-output.md')
