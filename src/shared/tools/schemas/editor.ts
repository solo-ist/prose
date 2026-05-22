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
    "Replace the content of a specific node by ID. Use read_document first to see all nodes with their IDs, then target the node you want to edit. Always include the search parameter with the original text for reliability. Special nodeId: pass 'frontmatter' with the COMPLETE new YAML (with or without --- fences) to direct-write the frontmatter block (no overlay, no search needed).",
  schema: editSchema,
  category: 'editor',
  requiresMode: 'create', // Direct writes — only available in Create Mode
  dangerous: false
}

// ============================================================================
// insert
// ============================================================================

export const insertSchema = z.object({
  text: z.string().describe('Text to insert at the specified position'),
  position: z
    .enum(['cursor', 'start', 'end', 'after_node', 'before_node'])
    .optional()
    .default('cursor')
    .describe(
      'Where to insert. Use after_node or before_node (paired with nodeId from read_document) when adding to a specific section — e.g., after_node with a heading nodeId to append content under that heading. Use cursor when the user said "here", OR when the user has a non-empty selection and asks to replace it: position=cursor over a selection deletes the selected range and inserts the new text in its place. start/end target the document boundaries.'
    ),
  nodeId: z
    .string()
    .optional()
    .describe(
      'Required when position is after_node or before_node. Get from read_document. To append to a section, use the heading nodeId with position=after_node — the text lands as a new node immediately after the heading.'
    ),
  search: z
    .string()
    .optional()
    .describe(
      'Original text content of the anchor node (from read_document). Used as fallback to locate the node if nodeId is stale.'
    )
})

export const insertConfig: ToolConfig<typeof insertSchema> = {
  name: 'insert',
  description:
    'Insert text at the specified position in the document. For "add to section X", call read_document first to get the section heading\'s nodeId, then call insert with position=after_node and that nodeId. For "replace this with X" when the user has a non-empty selection, use position=cursor — insert deletes the selection and inserts the new text in its place. Important: the selection-replace path depends on the selection still being live at call time. If you call other tools that may clear selection (e.g., read_document) between the user\'s request and the insert, the selection collapses and what was meant as a replacement becomes a plain cursor insert — read_selection is safer if you need to confirm the range before acting. Otherwise avoid position=cursor unless the user said "here".',
  schema: insertSchema,
  category: 'editor',
  requiresMode: 'create',
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
  // Suggestions are still mutations of pending document state (the diff
  // overlay). Editor Mode's defining capability; Chat Mode stays read-only.
  requiresMode: 'editor',
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
  // Accepting a diff commits a content mutation. Chat Mode stays read-only.
  requiresMode: 'editor',
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
  // Rejecting a diff dismisses pending state. Symmetric with accept_diff;
  // belongs in Editor Mode so Chat stays purely read-only.
  requiresMode: 'editor',
  dangerous: false
}

// ============================================================================
// delete_node
// ============================================================================

export const deleteNodeSchema = z.object({
  nodeId: z
    .string()
    .describe(
      'The ID of the node to delete. Get node IDs from read_document which lists all nodes with their IDs.'
    ),
  search: z
    .string()
    .optional()
    .describe(
      'Original text content of the node (from read_document). Used as fallback to locate the node if nodeId is stale.'
    )
})

export const deleteNodeConfig: ToolConfig<typeof deleteNodeSchema> = {
  name: 'delete_node',
  description:
    'Delete a specific node by ID. Use read_document first to see all nodes with their IDs, then target the node you want to remove. Include the search parameter with the original text for reliability if the node ID may be stale.',
  schema: deleteNodeSchema,
  category: 'editor',
  requiresMode: 'create', // Destructive — only available in Create Mode
  dangerous: false
}

// ============================================================================
// move_cursor
// ============================================================================

export const moveCursorSchema = z.object({
  nodeId: z
    .string()
    .describe(
      'The ID of the node to move the cursor to. Get node IDs from read_document.'
    ),
  position: z
    .enum(['start', 'end'])
    .optional()
    .default('start')
    .describe('Where in the node to place the cursor: at the start (default) or end of its content.'),
  search: z
    .string()
    .optional()
    .describe(
      'Original text content of the node (from read_document). Used as fallback to locate the node if nodeId is stale.'
    )
})

export const moveCursorConfig: ToolConfig<typeof moveCursorSchema> = {
  name: 'move_cursor',
  description:
    "Move the user's text cursor to a specific node. Useful before calling insert with position 'cursor' to park the cursor at a known location. Use read_document first to get node IDs.",
  schema: moveCursorSchema,
  category: 'editor',
  // Non-destructive selection change — available in Editor (and Create by inheritance).
  requiresMode: 'editor',
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
  rejectDiffConfig,
  deleteNodeConfig,
  moveCursorConfig
] as const
