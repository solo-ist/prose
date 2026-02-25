/**
 * Fixture markdown files pre-populated in the web mode mock filesystem.
 * These exercise the full UI: headings, lists, frontmatter, formatting, etc.
 */

export const FIXTURES: Record<string, string> = {
  '/Documents/Welcome to Prose.md': `# Welcome to Prose

Prose is a minimal markdown editor with AI-powered writing assistance.

## Getting Started

Open a file from the sidebar on the left, or create a new one with **Cmd+N**.

You can write in plain Markdown and Prose will render it beautifully.

## Features

- **AI Chat** — Press \`Cmd+K\` to open the AI chat panel
- **File Explorer** — Browse and manage your markdown files
- **Tabs** — Open multiple files at once
- **Dark Mode** — Easy on the eyes by default

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New file | Cmd+N |
| Open file | Cmd+O |
| Save | Cmd+S |
| AI Chat | Cmd+K |
| Toggle sidebar | Cmd+B |

Enjoy writing!
`,

  '/Documents/Formatting Examples.md': `# Formatting Examples

This file demonstrates the formatting options available in Prose.

## Text Formatting

**Bold text** is wrapped in double asterisks.
*Italic text* uses single asterisks.
~~Strikethrough~~ uses tildes.
\`Inline code\` uses backticks.

## Links and Images

Here is a [link to a website](https://example.com).

## Code Blocks

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`
}

console.log(greet('world'))
\`\`\`

## Blockquotes

> "The best writing is rewriting." — E.B. White

## Horizontal Rules

---

## Lists

Unordered:
- Item one
- Item two
  - Nested item
  - Another nested item
- Item three

Ordered:
1. First step
2. Second step
3. Third step
`,

  '/Documents/Meeting Notes/Weekly Standup.md': `# Weekly Standup Notes

## Week of February 24, 2026

### Attendees
- Alice Chen
- Bob Martinez
- Carol Williams
- David Kim

### Updates

#### Alice
- [x] Completed API integration for user auth
- [x] Reviewed PR #142
- [ ] Deploy staging environment
- [ ] Write documentation for new endpoints

#### Bob
- [x] Fixed mobile layout issues on dashboard
- [ ] Complete accessibility audit
- [ ] Update component library

#### Carol
- [x] Set up CI/CD pipeline for new service
- [x] Database migration complete
- [ ] Performance testing

#### David
- [ ] Design review for onboarding flow
- [ ] User research interviews (3 scheduled)

### Blockers

- Waiting on infrastructure access from IT
- Need design approval for new modals

### Action Items

1. Alice to share staging URL by Wednesday
2. David to send research findings by Friday
3. Team to review and merge open PRs before EOD Thursday
`,

  '/Documents/Meeting Notes/Q1 Planning.md': `---
title: Q1 2026 Planning Session
date: 2026-01-15
attendees:
  - Engineering
  - Product
  - Design
tags:
  - planning
  - quarterly
status: completed
---

# Q1 2026 Planning Session

## Goals

1. **Ship v2.0** — Major redesign with improved performance
2. **Mobile app** — iOS and Android beta release
3. **API v3** — Breaking changes for improved DX
4. **Growth** — 10k → 25k active users

## Timeline

### January
- Finalize designs for v2.0
- Begin API v3 spec

### February
- v2.0 development sprint
- Mobile app architecture

### March
- v2.0 launch
- API v3 beta
- Mobile app internal testing

## Budget

| Category | Allocated | Notes |
|----------|-----------|-------|
| Engineering | $120,000 | 3 FTE |
| Design | $40,000 | 1 FTE + contractor |
| Marketing | $25,000 | Launch campaign |
| Infrastructure | $15,000 | Scaling for growth |

## Risks

- API v3 may delay if scope expands
- Mobile requires additional QA time
- Holiday season reduces velocity in late December (Q4 carry-over)
`,

  '/Documents/Blog Drafts/AI Writing Tools.md': `# The Rise of AI Writing Tools: What Actually Works

*Draft — February 2026*

The past few years have seen an explosion of AI-powered writing tools. From grammar checkers to full-document generators, the landscape has changed dramatically. But which tools actually help writers, and which just add friction?

## What I've Tried

Over the past 18 months, I've tested dozens of AI writing tools. Some were impressive. Most were not. Here's what I've learned.

### Grammar and Style Checkers

Traditional grammar checkers have improved significantly with AI. The modern versions catch nuances that rules-based systems miss entirely. They understand context—they know that "I seen him" in a character's dialogue might be intentional.

**What works:** Catching inconsistencies in long documents. Flagging passive voice overuse. Suggesting simpler alternatives for complex sentences.

**What doesn't:** Homogenizing voice. Over-correcting for style guides the author never chose.

### AI Completion Tools

The autocomplete category has exploded. These tools suggest the next sentence, paragraph, or section based on what you've written so far.

**What works:** Overcoming blank-page paralysis. Generating rough outlines. Brainstorming alternatives when stuck.

**What doesn't:** First drafts for anything requiring genuine expertise. Fact-sensitive content. Anything where your voice matters.

### AI Chat Assistants Integrated into Editors

The most interesting category is AI chat built into the writing environment itself. Instead of copying text to a separate tool, you stay in context.

This is where tools like Prose come in. The ability to ask "make this paragraph clearer" or "add a counterargument here" without leaving the document is genuinely useful.

## My Recommendations

For most writers:

1. **Use AI for editing, not writing** — Let it critique your draft, not write it
2. **Treat suggestions as options** — Accept maybe 20-30% of AI suggestions
3. **Check every fact** — AI tools hallucinate with confidence
4. **Keep your voice** — If it sounds like AI wrote it, rewrite it

## The Future

The tools are going to get much better. But the fundamental challenge remains: good writing requires clear thinking, and no AI can do that for you.

*More to come...*
`,

  '/Documents/Empty Note.md': '',
}
