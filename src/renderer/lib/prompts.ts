/**
 * System prompts for LLM interactions
 */

export function buildSystemPrompt(includeDocument: boolean, documentContent?: string): string {
  let prompt = `You are a helpful writing assistant integrated into a markdown editor called Prose.
You help users with writing, editing, and organizing their documents.

Keep your responses concise and focused. When suggesting edits, be specific about what to change.`

  if (includeDocument && documentContent) {
    prompt += `

The user is currently working on the following document:

---
${documentContent}
---

You can reference and suggest edits to this document.`
  }

  return prompt
}
