/**
 * Parser for AI-generated edit blocks using SEARCH/REPLACE format.
 *
 * Format:
 * <<<<<<< SEARCH
 * text to find
 * =======
 * replacement text
 * >>>>>>> REPLACE
 */

export interface EditBlock {
  id: string
  search: string
  replace: string
}

/**
 * Regex to match SEARCH/REPLACE blocks.
 * Captures the search text (group 1) and replace text (group 2).
 * Handles optional markdown code block wrappers (```).
 */
const EDIT_BLOCK_REGEX =
  /(?:```\n?)?<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE(?:\n?```)?/g

/**
 * Generate a unique ID for an edit block.
 */
function generateId(): string {
  return `edit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Parse edit blocks from a message content string.
 * Returns an array of EditBlock objects with unique IDs.
 */
export function parseEditBlocks(content: string): EditBlock[] {
  const blocks: EditBlock[] = []
  let match: RegExpExecArray | null

  // Reset regex state
  EDIT_BLOCK_REGEX.lastIndex = 0

  while ((match = EDIT_BLOCK_REGEX.exec(content)) !== null) {
    const search = match[1].trim()
    const replace = match[2].trim()

    // Skip empty blocks
    if (!search && !replace) continue

    blocks.push({
      id: generateId(),
      search,
      replace,
    })
  }

  return blocks
}

/**
 * Check if a message contains any edit blocks.
 */
export function hasEditBlocks(content: string): boolean {
  EDIT_BLOCK_REGEX.lastIndex = 0
  return EDIT_BLOCK_REGEX.test(content)
}

/**
 * Replace edit blocks with just the replacement text for inline display.
 * Shows what the new text will be in the flow of the message.
 */
export function stripEditBlocks(content: string): string {
  return content.replace(EDIT_BLOCK_REGEX, (_match, _search, replace) => {
    return replace.trim()
  }).trim()
}

/**
 * Count the number of edit blocks in a message.
 */
export function countEditBlocks(content: string): number {
  EDIT_BLOCK_REGEX.lastIndex = 0
  const matches = content.match(EDIT_BLOCK_REGEX)
  return matches ? matches.length : 0
}
