---
name: review-feedback
description: Pragmatic analysis of PR feedback. Validates issues, assesses severity, and recommends actions (fix, defer, or dismiss).
---

# Review PR Feedback

Pragmatic analysis of PR review comments. Validates concerns, assesses severity, and provides actionable recommendations.

## Philosophy

**Pragmatism over compliance.** This skill does not blindly accept all feedback:

- Validate that issues are real and reproducible
- Weigh effort vs. impact
- Recommend deferring low-priority issues to follow-up tickets
- Focus on shipping quality code, not perfect code

## Usage

```
/review-feedback <pr-number>
```

## Workflow

### 1. Fetch PR and Review Comments

Use the GitHub MCP to get PR information and all review comments:

```
mcp__github__pull_request_read (method: "get", owner: "solo-ist", repo: "prose", pullNumber: <pr-number>)
```

Then fetch review comments (inline code comments):

```
mcp__github__pull_request_read (method: "list_reviews", owner: "solo-ist", repo: "prose", pullNumber: <pr-number>)
mcp__github__pull_request_read (method: "get_review_comments", owner: "solo-ist", repo: "prose", pullNumber: <pr-number>)
```

And general PR comments:

```
mcp__github__pull_request_read (method: "get_comments", owner: "solo-ist", repo: "prose", pullNumber: <pr-number>)
```

### 2. Categorize Feedback

Group each piece of feedback into categories:

| Category | Description | Examples |
|----------|-------------|----------|
| **Blocking** | Security, crashes, data loss | SQL injection, null pointer, file corruption |
| **Functional** | Bugs, broken features | Feature doesn't work, edge case failure |
| **Code Quality** | Style, patterns, maintainability | Naming conventions, design patterns |
| **Nitpicks** | Preferences, minor suggestions | Formatting, comment wording |
| **Questions** | Clarifications, not actionable | "Why did you choose X?" |

### 3. Validate Each Issue

For each piece of feedback, investigate:

1. **Is it real?** - Read the code, understand the context, reproduce if possible
2. **Is it in scope?** - Does it relate to this PR's changes, or is it pre-existing?
3. **Is it accurate?** - Is the reviewer's assessment correct?

**Read the actual code files** to validate. Don't trust summaries.

### 4. Assess Severity & Impact

For validated issues:

| Dimension | Levels |
|-----------|--------|
| **Severity** | Critical / High / Medium / Low |
| **Effort** | Quick fix (< 5 min) / Moderate (< 30 min) / Significant refactor |
| **Risk** | What happens if we don't fix it? |

### 5. Generate Recommendations

Output this structured analysis:

```markdown
## PR Feedback Analysis: #<number>

### Summary
<1-2 sentence overview of feedback and recommendation>

### Recommendation: [MERGE | FIX REQUIRED | NEEDS DISCUSSION]

---

### Must Fix Before Merge
| Issue | Severity | Effort | Rationale |
|-------|----------|--------|-----------|
| ... | Critical | Quick | ... |

### Consider Fixing
| Issue | Severity | Effort | Recommendation |
|-------|----------|--------|----------------|
| ... | Medium | Moderate | Fix now / Defer |

### Defer to Follow-up
| Issue | Rationale | Suggested Ticket |
|-------|-----------|------------------|
| ... | Out of scope | "Refactor X for consistency" |

### Dismissed
| Feedback | Reason |
|----------|--------|
| ... | Style preference, not a bug |

---

### Follow-up Tickets (if applicable)
Ready-to-create issue descriptions for deferred items.
```

### 6. Optional: Create Follow-up Issues

If the user approves, create GitHub issues for deferred items:

```
mcp__github__issue_write (method: "create", owner: "solo-ist", repo: "prose", title: "...", body: "...")
```

## Key Principles

1. **Validate before acting** - Don't assume feedback is correct. Read the code.
2. **Scope matters** - Reject scope creep politely. Pre-existing issues belong in separate tickets.
3. **Effort vs Impact** - A 2-hour fix for a cosmetic issue isn't worth blocking a merge.
4. **Ship it** - Perfect is the enemy of good. Working code today beats perfect code never.
5. **Document deferrals** - Create tickets so nothing is lost. Defer, don't ignore.

## Analysis Guidelines

### When to recommend MERGE:
- No blocking issues
- All functional issues addressed
- Remaining feedback is cosmetic or out-of-scope

### When to recommend FIX REQUIRED:
- Blocking issues exist (security, crashes, data loss)
- Functional bugs that affect users
- Tests failing or missing for critical paths

### When to recommend NEEDS DISCUSSION:
- Significant architectural concerns
- Scope disagreement between reviewer and author
- Trade-offs that need team input

## Example Output

```markdown
## PR Feedback Analysis: #42

### Summary
Reviewer flagged 5 items: 1 valid bug, 2 style preferences, 1 pre-existing issue, 1 question.
The bug is a quick fix; other items can be deferred or dismissed.

### Recommendation: FIX REQUIRED

---

### Must Fix Before Merge
| Issue | Severity | Effort | Rationale |
|-------|----------|--------|-----------|
| Null check missing in `handleSave` | High | Quick | Crashes on new files |

### Consider Fixing
| Issue | Severity | Effort | Recommendation |
|-------|----------|--------|----------------|
| Variable naming (`tmp` vs `tempFile`) | Low | Quick | Fix now - easy win |

### Defer to Follow-up
| Issue | Rationale | Suggested Ticket |
|-------|-----------|------------------|
| Refactor file service to use Result type | Pre-existing code, out of scope | "Refactor file service error handling" |

### Dismissed
| Feedback | Reason |
|----------|--------|
| "Consider using lodash here" | Adds 70kb dep for one function, native works fine |
| "Why not use React Query?" | Question, not actionable. Current approach works. |

---

### Follow-up Tickets

**Title:** Refactor file service error handling
**Body:**
The file service currently uses try/catch with mixed return types. Consider:
- Using a Result<T, E> pattern for explicit error handling
- Consolidating error types

Related: PR #42 review feedback
```
