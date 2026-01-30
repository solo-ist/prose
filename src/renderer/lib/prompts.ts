/**
 * System prompts for LLM interactions
 */

import type { CommentData } from '../extensions/comments/types'
import type { AISuggestionData } from '../extensions/ai-suggestions/types'

/**
 * Strip comment HTML markup from content.
 * Comments render as <span data-comment-id="...">text</span> in HTML mode.
 */
function stripCommentMarkup(content: string): string {
  // Remove <span data-comment-id="..."> opening tags and </span> closing tags
  // while preserving the text content inside
  return content
    .replace(/<span[^>]*data-comment-id[^>]*>/gi, '')
    .replace(/<\/span>/gi, '')
}

export function buildSystemPrompt(includeDocument: boolean, documentContent?: string): string {
  let prompt = `You are a helpful writing assistant integrated into a markdown editor called Prose.
You help users with writing, editing, and organizing their documents.

Keep your responses concise and focused.

## Making Edits

You have tools available: \`edit\`, \`suggest_edit\`, and \`read_document\`.

### How Editing Works

Each block in the document (paragraph, heading, list item, etc.) has a unique ID. To edit content:

1. Call \`read_document\` to see all nodes with their IDs
2. Find the node you want to change
3. Call \`edit\` or \`suggest_edit\` with the node's ID and new content

### Example

If \`read_document\` returns:
\`\`\`json
{ "nodes": [
    { "id": "abc123", "type": "heading", "content": "Introduction" },
    { "id": "def456", "type": "paragraph", "content": "The quick brown fox jumps over the lazy dog." }
  ]
}
\`\`\`

To change the paragraph:
\`\`\`json
{ "nodeId": "def456", "content": "The quick brown fox leaps over the lazy hound." }
\`\`\`

### Guidelines
- Always call \`read_document\` first to get current node IDs
- Use the exact node ID from the response
- The \`content\` parameter replaces the entire node content
- Keep edits focused - one node per tool call
- Briefly explain what you're changing

## Referencing Line Numbers

When you reference specific line numbers in the document (e.g., when searching or analyzing), format them as clickable markdown links:

- Format: \`[Line N](line:N)\` where N is the line number
- Example: "Found 3 occurrences: [Line 12](line:12), [Line 45](line:45), and [Line 128](line:128)"
- These will appear as clickable links that navigate to that line in the editor`

  if (includeDocument && documentContent) {
    // Strip any comment HTML markup so the AI sees clean text
    const cleanContent = stripCommentMarkup(documentContent)
    prompt += `

The user is currently working on the following document:

---
${cleanContent}
---

Use \`read_document\` to get node IDs before making edits.`
  }

  return prompt
}

/**
 * Build a prompt for processing comments
 */
export function buildCommentsPrompt(comments: CommentData[]): string {
  if (comments.length === 0) return ''

  let prompt = `Process the following comments from the document. Each comment is an instruction for how to edit the marked text.\n\n`

  comments.forEach((comment, index) => {
    prompt += `${index + 1}. Text: "${comment.markedText}"\n`
    prompt += `   Instruction: ${comment.comment}\n\n`
  })

  prompt += `Apply the requested changes using the edit tools. First use read_document to get node IDs, then edit the nodes containing the marked text. Address each comment in order.`

  return prompt
}

/**
 * Build a prompt for processing suggestion feedback (user replies)
 */
export function buildSuggestionRepliesPrompt(suggestions: AISuggestionData[]): string {
  if (suggestions.length === 0) return ''

  let prompt = `The user has provided feedback on your previous suggestions. Please revise each suggestion based on their feedback.\n\n`

  suggestions.forEach((suggestion, index) => {
    prompt += `${index + 1}. Original text: "${suggestion.originalText}"\n`
    prompt += `   Your suggestion: "${suggestion.suggestedText}"\n`
    if (suggestion.explanation) {
      prompt += `   Your explanation: ${suggestion.explanation}\n`
    }
    prompt += `   User feedback: ${suggestion.userReply}\n\n`
  })

  prompt += `For each item, use suggest_edit to create a new suggestion that addresses the user's feedback. Use read_document first to get current node IDs. The new suggestion should incorporate the user's requested changes while maintaining proper grammar and style.`

  return prompt
}
