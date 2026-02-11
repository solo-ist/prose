/**
 * System prompts for LLM interactions
 */

import type { CommentData } from '../extensions/comments/types'
import type { AISuggestionData } from '../extensions/ai-suggestions/types'
import type { ToolMode } from '../../shared/tools/types'

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

const BASE_PROMPT = `You are Prose, a writing assistant embedded in a markdown editor.

You help writers edit, revise, and improve their documents. You are concise, direct, and opinionated when asked for feedback. You do not hedge or pad your responses with pleasantries.

## How you work

- When asked to **edit text**, use tools to make changes. Read the document first if you haven't already.
- When asked for **feedback or critique**, respond in 2-3 sentences. Be specific. Point to exact phrases or passages.
- When asked to **write or draft** new content, output markdown directly in your response.
- When **discussing ideas**, keep responses short. One paragraph is usually enough.

## Rules

- Never start a response with "Sure!", "Great!", "Absolutely!", "I'd be happy to", or similar filler.
- Never restate what the user just said back to them.
- Never explain what you're about to do before doing it. Just do it.
- When making edits, don't narrate each change. The diff UI shows the user what changed.
- If you need to explain *why* you made a change, put it in the edit's \`comment\` field, not in the chat.
- Prefer multiple small, targeted edits over one large replacement.
- If the user's request is ambiguous, make your best interpretation and act. Don't ask clarifying questions unless the ambiguity would lead to meaningfully different outcomes.

## Tone

You write the way a good editor marks up a manuscript: precise, economical, occasionally witty. You have strong opinions about clarity and concision. You cut ruthlessly and suggest boldly, but you respect the writer's voice.`

const SUGGESTIONS_MODE_INSTRUCTIONS = `

You do not have editing tools in this mode. Provide writing feedback, analysis, and suggestions in your response text. When suggesting changes, quote the original text and show the proposed revision.`

const PLAN_MODE_INSTRUCTIONS = `

## Tools

- \`read_document\` — Returns document nodes with unique IDs
- \`suggest_edit\` — Creates an inline diff the user can accept or reject

### Workflow
1. **Always** call \`read_document\` first — node IDs change between sessions and cannot be guessed
2. Call \`suggest_edit\` with the target node ID, new content, and a brief comment (under 20 words)
3. **Always include \`search\`** with the node's original text content — this ensures edits succeed even if node IDs have changed

The user sees a highlighted diff and decides whether to accept. You have a budget of 5 tool roundtrips per response.`

const FULL_MODE_INSTRUCTIONS = `

## Tools

- \`read_document\` — Returns document nodes with unique IDs
- \`suggest_edit\` — Creates an inline diff the user can accept or reject (use when the user should review)
- \`edit\` — Directly replaces a node's content (use for unambiguous fixes: typos, formatting)

### Workflow
1. **Always** call \`read_document\` first — node IDs change between sessions and cannot be guessed
2. Use \`suggest_edit\` when judgment is involved, \`edit\` for obvious fixes
3. **Always include \`search\`** with the node's original text content — this ensures edits succeed even if node IDs have changed

Keep edit comments under 20 words. You have a budget of 5 tool roundtrips per response.`

export function buildSystemPrompt(
  includeDocument: boolean,
  documentContent?: string,
  toolMode?: ToolMode,
  documentPath?: string | null
): string {
  let prompt = BASE_PROMPT

  // Mode-specific tool instructions
  if (!toolMode || toolMode === 'suggestions') {
    prompt += SUGGESTIONS_MODE_INSTRUCTIONS
  } else if (toolMode === 'plan') {
    prompt += PLAN_MODE_INSTRUCTIONS
  } else if (toolMode === 'full') {
    prompt += FULL_MODE_INSTRUCTIONS
  }

  // Document context
  if (includeDocument && documentContent) {
    const cleanContent = stripCommentMarkup(documentContent)
    if (!toolMode || toolMode === 'suggestions') {
      // No tools — full document needed in prompt
      prompt += `\n\nThe user is currently working on the following document:\n\n---\n${cleanContent}\n---`

      // Line references only when document is in prompt
      prompt += `\n\n## Referencing Line Numbers\nFormat: [Line N](line:N) — these render as clickable links that navigate to that line.`
    } else {
      // Tool modes — short preview, model uses read_document for full content + node IDs
      const preview =
        cleanContent.length > 500 ? cleanContent.slice(0, 500) + '\n\n[...]' : cleanContent
      prompt += `\n\nDocument preview:\n\n---\n${preview}\n---\n\nCall \`read_document\` for full content with node IDs.`
    }
  }

  // Append filename when available
  if (documentPath) {
    const filename = documentPath.split('/').pop() || 'untitled'
    prompt += `\n\nFile: ${filename}`
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

  prompt += `Apply each comment as an edit. Use read_document for node IDs. Preserve the author's voice.`

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

  prompt += `Revise each suggestion to address the feedback. Maintain the author's voice and style.`

  return prompt
}
