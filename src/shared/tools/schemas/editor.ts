/**
 * Editor tool schemas - tools for modifying document content.
 */

import { z } from 'zod'
import type { ToolConfig } from '../types'

// ============================================================================
// edit
// ============================================================================

export const editSchema = z.object({
  search: z.string().describe('Text to find in the document (exact or fuzzy match)'),
  replace: z.string().describe('Replacement text'),
  fuzzy: z
    .boolean()
    .optional()
    .default(true)
    .describe('Allow fuzzy matching if exact match fails (default: true)')
})

export const editConfig: ToolConfig<typeof editSchema> = {
  name: 'edit',
  description:
    'Replace text in the document using SEARCH/REPLACE pattern. Applies the edit directly.',
  schema: editSchema,
  category: 'editor',
  requiresMode: 'full', // Only available in Full Autonomy mode
  dangerous: false
}

// ============================================================================
// insert
// ============================================================================

export const insertSchema = z.object({
  text: z.string().describe('Text to insert at the current cursor position'),
  position: z
    .enum(['cursor', 'start', 'end'])
    .optional()
    .default('cursor')
    .describe('Where to insert: at cursor, document start, or document end')
})

export const insertConfig: ToolConfig<typeof insertSchema> = {
  name: 'insert',
  description: 'Insert text at the specified position in the document',
  schema: insertSchema,
  category: 'editor',
  requiresMode: 'full',
  dangerous: false
}

// ============================================================================
// suggest_edit
// ============================================================================

export const suggestEditSchema = z.object({
  search: z.string().describe('Text to find in the document'),
  replace: z.string().describe('Suggested replacement text'),
  comment: z
    .string()
    .optional()
    .describe('Optional comment explaining the suggested change'),
  fuzzy: z
    .boolean()
    .optional()
    .default(true)
    .describe('Allow fuzzy matching if exact match fails')
})

export const suggestEditConfig: ToolConfig<typeof suggestEditSchema> = {
  name: 'suggest_edit',
  description:
    'Show a diff suggestion without applying it. The user can accept or reject.',
  schema: suggestEditSchema,
  category: 'editor',
  requiresMode: null, // Available in all modes
  dangerous: false
}

// ============================================================================
// accept_diff
// ============================================================================

export const acceptDiffSchema = z.object({
  id: z
    .string()
    .optional()
    .describe('ID of the diff to accept. If omitted, accepts the first pending diff.')
})

export const acceptDiffConfig: ToolConfig<typeof acceptDiffSchema> = {
  name: 'accept_diff',
  description: 'Accept a pending diff suggestion, applying the change to the document',
  schema: acceptDiffSchema,
  category: 'editor',
  requiresMode: null, // Available in all modes
  dangerous: false
}

// ============================================================================
// reject_diff
// ============================================================================

export const rejectDiffSchema = z.object({
  id: z
    .string()
    .optional()
    .describe('ID of the diff to reject. If omitted, rejects the first pending diff.')
})

export const rejectDiffConfig: ToolConfig<typeof rejectDiffSchema> = {
  name: 'reject_diff',
  description: 'Reject a pending diff suggestion, keeping the original text',
  schema: rejectDiffSchema,
  category: 'editor',
  requiresMode: null, // Available in all modes
  dangerous: false
}

// ============================================================================
// Export all editor tools
// ============================================================================

export const editorTools = [
  editConfig,
  insertConfig,
  suggestEditConfig,
  acceptDiffConfig,
  rejectDiffConfig
] as const
