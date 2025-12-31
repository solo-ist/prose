/**
 * System prompts for LLM interactions
 */

import type { CommentData } from '../extensions/comments/types'

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

When the user asks you to edit, revise, or change text, use SEARCH/REPLACE blocks.
Your edits will be applied directly to their document.

Format:

<<<<<<< SEARCH
text to find
=======
replacement text
>>>>>>> REPLACE

Guidelines:
1. Include enough text in SEARCH to uniquely identify the location
2. The text doesn't need to be exact - close matches will still work
3. Keep edits focused - one logical change per block
4. You can use multiple blocks for multiple changes
5. Briefly explain what you're changing

Example:
"I'll improve the flow of this sentence:"

<<<<<<< SEARCH
The quick brown fox jumps.
=======
The swift brown fox leaps gracefully.
>>>>>>> REPLACE`

  if (includeDocument && documentContent) {
    // Strip any comment HTML markup so the AI sees clean text
    const cleanContent = stripCommentMarkup(documentContent)
    prompt += `

The user is currently working on the following document:

---
${cleanContent}
---

Use SEARCH/REPLACE blocks to make edits to this document.`
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

  prompt += `Apply the requested changes using SEARCH/REPLACE blocks. Address each comment in order.`

  return prompt
}
