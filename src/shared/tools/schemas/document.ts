/**
 * Document tool schemas - read-only tools for accessing document content.
 */

import { z } from 'zod'
import type { ToolConfig } from '../types'

// ============================================================================
// read_document
// ============================================================================

export const readDocumentSchema = z.object({}).describe('No parameters required')

export const readDocumentConfig: ToolConfig<typeof readDocumentSchema> = {
  name: 'read_document',
  description:
    "Get the document as a structured node tree, each node with a unique ID. Returns { nodes: DocumentNode[], markdown }. DocumentNode shape: { id, type, content, children?: DocumentNode[] }. Container nodes (blockquote, bulletList, orderedList, listItem, taskItem) carry a children array with their nested nodes; their content is the concatenated text of all descendants. Leaf nodes (paragraph, heading, codeBlock) have no children. Node IDs are required for edit and suggest_edit calls — always target the most specific (innermost) node. Do NOT target a container when you mean to edit a specific child. If the document has frontmatter, a synthetic node with id: 'frontmatter', type: 'frontmatter' is prepended to the nodes array — call suggest_edit with nodeId: 'frontmatter' and the COMPLETE new YAML (with or without --- fences) to propose frontmatter changes; do not try to address individual fields.",
  schema: readDocumentSchema,
  category: 'document',
  requiresMode: null, // Available in all modes
  dangerous: false
}

// ============================================================================
// read_selection
// ============================================================================

export const readSelectionSchema = z.object({}).describe('No parameters required')

export const readSelectionConfig: ToolConfig<typeof readSelectionSchema> = {
  name: 'read_selection',
  description:
    'Get the currently selected text and its position. Returns empty if no selection.',
  schema: readSelectionSchema,
  category: 'document',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// get_metadata
// ============================================================================

export const getMetadataSchema = z.object({}).describe('No parameters required')

export const getMetadataConfig: ToolConfig<typeof getMetadataSchema> = {
  name: 'get_metadata',
  description:
    'Get document metadata including path, word count, frontmatter, and dirty state',
  schema: getMetadataSchema,
  category: 'document',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// search_document
// ============================================================================

export const searchDocumentSchema = z.object({
  query: z.string().describe('Text or regex pattern to search for'),
  regex: z
    .boolean()
    .optional()
    .default(false)
    .describe('Treat query as a regular expression'),
  caseSensitive: z
    .boolean()
    .optional()
    .default(false)
    .describe('Enable case-sensitive matching'),
  maxResults: z
    .number()
    .optional()
    .default(50)
    .describe('Maximum number of matches to return')
})

export const searchDocumentConfig: ToolConfig<typeof searchDocumentSchema> = {
  name: 'search_document',
  description:
    'Search the document for text or regex matches. Returns match positions with line numbers. Useful for locating content before targeting edits.',
  schema: searchDocumentSchema,
  category: 'document',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// get_outline
// ============================================================================

export const getOutlineSchema = z.object({}).describe('No parameters required')

export const getOutlineConfig: ToolConfig<typeof getOutlineSchema> = {
  name: 'get_outline',
  description: 'Get the document structure as a list of headings with their levels',
  schema: getOutlineSchema,
  category: 'document',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// list_comments
// ============================================================================

export const listCommentsSchema = z.object({}).describe('No parameters required')

export const listCommentsConfig: ToolConfig<typeof listCommentsSchema> = {
  name: 'list_comments',
  description:
    'List all comments in the active document. Returns { comments: [{ id, markedText, comment, createdAt, from, to }] }.',
  schema: listCommentsSchema,
  category: 'document',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// add_comment
// ============================================================================

export const addCommentSchema = z.object({
  nodeId: z
    .string()
    .optional()
    .describe(
      'ID of the node to attach the comment to. Get node IDs from read_document. Provide either nodeId or from/to, not both.'
    ),
  from: z
    .number()
    .optional()
    .describe('Document position (from) for the comment range. Use when nodeId is unavailable.'),
  to: z
    .number()
    .optional()
    .describe('Document position (to) for the comment range. Use when nodeId is unavailable.'),
  comment: z.string().describe('The comment text to attach to the selected content.')
})

export const addCommentConfig: ToolConfig<typeof addCommentSchema> = {
  name: 'add_comment',
  description:
    'Add a comment to a node or range in the document. Provide nodeId (preferred, from read_document) or from/to positions. Returns { id } of the new comment.',
  schema: addCommentSchema,
  category: 'document',
  // Comments mutate document state; Chat Mode stays read-only. Editor Mode
  // needs add_comment to deliver the non-authorship affordance: the agent
  // can flag editorial issues without proposing replacement prose.
  requiresMode: 'editor',
  dangerous: false
}

// ============================================================================
// resolve_comment
// ============================================================================

export const resolveCommentSchema = z.object({
  id: z.string().describe('ID of the comment to resolve. Get IDs from list_comments. Resolved threads persist as collapsed history rather than being deleted.')
})

export const resolveCommentConfig: ToolConfig<typeof resolveCommentSchema> = {
  name: 'resolve_comment',
  description:
    'Resolve a comment by its ID. Sets resolved:true on the thread — the thread persists as collapsed history rather than being deleted. Use list_comments to see all comment IDs.',
  schema: resolveCommentSchema,
  category: 'document',
  // Sibling of add_comment — resolving a comment is also a mutation, so it
  // belongs in Editor Mode and up. list_comments stays read-only.
  requiresMode: 'editor',
  dangerous: false
}

// ============================================================================
// reopen_comment
// ============================================================================

export const reopenCommentSchema = z.object({
  id: z.string().min(1).describe('ID of the resolved comment thread to reopen. Get IDs from list_comments.')
})

export const reopenCommentConfig: ToolConfig<typeof reopenCommentSchema> = {
  name: 'reopen_comment',
  description:
    'Reopen a resolved comment thread by its ID. The thread remains in history and its anchor is restored when possible.',
  schema: reopenCommentSchema,
  category: 'document',
  requiresMode: 'editor',
  dangerous: false
}

// ============================================================================
// reply_to_comment
// ============================================================================

export const replyToCommentSchema = z.object({
  id: z.string().describe('ID of the comment thread to reply to. Get IDs from list_comments.'),
  text: z.string().describe('The reply text to add to the thread.')
})

export const replyToCommentConfig: ToolConfig<typeof replyToCommentSchema> = {
  name: 'reply_to_comment',
  description:
    'Add an AI reply to an existing comment thread. Use list_comments to get comment IDs. The reply appears in the thread view. After replying, call resolve_comment if the comment is fully addressed.',
  schema: replyToCommentSchema,
  category: 'document',
  // Posting a reply is a mutation; requires Editor Mode or above.
  requiresMode: 'editor',
  dangerous: false
}

// ============================================================================
// Export all document tools
// ============================================================================

export const documentTools = [
  readDocumentConfig,
  readSelectionConfig,
  getMetadataConfig,
  searchDocumentConfig,
  getOutlineConfig,
  listCommentsConfig,
  addCommentConfig,
  resolveCommentConfig,
  reopenCommentConfig,
  replyToCommentConfig
] as const
