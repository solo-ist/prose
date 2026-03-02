/**
 * Fixture files for web mode mock filesystem.
 * Pre-populated content to exercise the UI without a real filesystem.
 */

export const DOCUMENTS_ROOT = '/Documents'

export const fixtures: Record<string, string> = {
  '/Documents/Welcome to Prose.md': `# Welcome to Prose

Prose is a minimal markdown editor with AI chat. You're running in **web mode** — a browser-based version backed by an in-memory filesystem.

## Getting Started

- Open a file from the sidebar on the left
- Press **Cmd+/** (or **Ctrl+/**) to open the AI chat panel
- Use the toolbar at the top to create new files, save, and navigate

## Features

- **Rich markdown editing** with TipTap
- **AI-powered writing assistance** via Claude
- **File explorer** with folder navigation
- **Multiple tabs** — open several files at once
- **Dark mode** by default

> **Note:** You're in web mode. Changes persist within this browser session only.
`,

  '/Documents/Formatting Examples.md': `# Formatting Examples

This file demonstrates the markdown formatting supported by Prose.

## Text Styles

You can write **bold text**, *italic text*, or ***bold and italic***.

Use \`inline code\` for short snippets, or ~~strikethrough~~ for deletions.

## Lists

### Unordered Lists

- First item
- Second item
  - Nested item
  - Another nested item
- Third item

### Ordered Lists

1. First step
2. Second step
3. Third step

### Task Lists

- [x] Completed task
- [ ] Pending task
- [ ] Another pending task

## Links and Images

[Visit Prose on GitHub](https://github.com)

## Code Blocks

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`
}

console.log(greet('World'))
\`\`\`

## Blockquotes

> "The best way to predict the future is to invent it."
> — Alan Kay

## Tables

| Feature | Status |
|---------|--------|
| Markdown | ✓ |
| AI Chat | ✓ |
| Sync | Electron only |

---

*End of formatting examples.*
`,

  '/Documents/Meeting Notes/Weekly Standup.md': `# Weekly Standup Notes

## 2026-03-01

### What did we accomplish this week?

- [x] Finished web mode implementation
- [x] Added fixture files for QA testing
- [x] Fixed file explorer lazy loading
- [ ] Deploy to Vercel for cloud QA

### What are we working on next?

- Image paste and drag-and-drop support (#270)
- Export as plain text (#271)
- Better select menu options (#263)

### Blockers

None this week.

---

## 2026-02-22

### Accomplishments

- [x] reMarkable sync improvements
- [x] Auto-review CI workflow
- [x] Frontmatter key-value editor spike

### Notes

Team sync moved to Tuesdays starting next week.
`,

  '/Documents/Meeting Notes/Q1 Planning.md': `---
title: Q1 2026 Planning
date: 2026-01-15
status: final
tags: [planning, roadmap, q1-2026]
---

# Q1 2026 Planning

## Objectives

1. **Core editor stability** — Fix known bugs, improve performance
2. **Cloud QA infrastructure** — Web mode build for Playwright testing
3. **Integration expansion** — Google Docs sync, reMarkable improvements
4. **User onboarding** — Better first-run experience

## Key Results

| Objective | Metric | Target |
|-----------|--------|--------|
| Editor stability | Crash-free rate | > 99% |
| Cloud QA | Test coverage | > 80% |
| Integrations | Sync success rate | > 95% |

## Timeline

- **Week 1-2**: Web mode build + fixture system
- **Week 3-4**: Google Docs sync v2
- **Week 5-6**: reMarkable UX improvements
- **Week 7-8**: Performance pass + polish

## Open Questions

- Should we support Obsidian vault import?
- WebDAV sync for self-hosted setups?
`,

  '/Documents/Blog Drafts/AI Writing Tools.md': `# AI Writing Tools in 2026: What Actually Works

*Draft — not for publication yet*

---

The landscape of AI writing tools has changed dramatically. After years of hype and disappointment, a few patterns have emerged that actually help writers rather than replacing them.

## The Shift from Generation to Assistance

Early AI writing tools focused on generating text from scratch. The results were mixed — technically coherent but stylistically flat. Writers didn't want a ghostwriter; they wanted a collaborator.

The tools that succeeded understood this. They help you:

- Unstick from writer's block with targeted prompts
- Strengthen existing prose without homogenizing your voice
- Catch structural issues across long documents
- Research and fact-check inline

## What Prose Does Differently

Prose keeps the AI in the sidebar. You're always in control of the document — the AI can suggest, highlight, or draft alternatives, but it never silently rewrites your work.

This matters because trust is fragile. One unexpected rewrite can make you second-guess every sentence you thought was yours.

## The Role of Context

The best AI writing interactions are deeply contextual. The model needs to understand:

- Your writing goals (inform, persuade, entertain)
- Your audience (experts, general public, specific community)
- Your voice (formal, conversational, technical)
- The document's structure and where you are in it

Most tools get this wrong by treating every request in isolation.

## Practical Workflow

After experimenting with various approaches, here's what works:

1. **Write first, edit with AI later** — Don't prompt before you have something on the page
2. **Be specific about scope** — "Improve this paragraph" beats "improve my writing"
3. **Iterate on rejections** — When AI suggestions miss, tell it why
4. **Use it for research, not authority** — AI-generated facts need verification

## Conclusion

*[Need to write this section]*

---

*Word count: ~350 | Target: 800-1000*
`,

  '/Documents/Empty Note.md': ``,
}
