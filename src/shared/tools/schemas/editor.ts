/**
 * Editor tool schemas - tools for modifying document content.
 */

import { z } from 'zod'
import type { ToolConfig } from '../types'

// ============================================================================
// edit
// ============================================================================

export const editSchema = z.object({
  nodeId: z
    .string()
    .describe(
      'The ID of the node to edit. Get node IDs from read_document which lists all nodes with their IDs.'
    ),
  content: z.string().describe('The new content for the node (replaces entire node content)'),
  search: z
    .string()
    .optional()
    .describe(
      'Original text content of the node (from read_document). Used as fallback to locate the node if nodeId is stale.'
    )
})

export const editConfig: ToolConfig<typeof editSchema> = {
  name: 'edit',
  description:
    'Replace the content of a specific node by ID. Use read_document first to see all nodes with their IDs, then target the node you want to edit. Always include the search parameter with the original text for reliability.',
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
  nodeId: z
    .string()
    .describe(
      'The ID of the node to suggest changes for. Get node IDs from read_document.'
    ),
  content: z.string().describe('The suggested new content for the node'),
  comment: z
    .string()
    .optional()
    .describe('Brief rationale for the change, shown in the diff UI. Keep under 20 words.'),
  search: z
    .string()
    .optional()
    .describe(
      'Original text content of the node (from read_document). Used as fallback to locate the node if nodeId is stale.'
    )
})

export const suggestEditConfig: ToolConfig<typeof suggestEditSchema> = {
  name: 'suggest_edit',
  description:
    'Create an inline diff suggestion on a node. The user sees a highlighted comparison and can accept or reject it. Use read_document first to get node IDs. Always include the search parameter with the original text for reliability.',
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
  description: 'Accept a pending suggestion. If no ID provided, accepts all pending suggestions.',
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
  description: 'Reject a pending suggestion. If no ID provided, rejects all pending suggestions.',
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
