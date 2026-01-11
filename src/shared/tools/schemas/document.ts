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
  description: 'Get the full markdown content of the current document',
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
  description: 'Find all occurrences of text or regex pattern in the document',
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
// Export all document tools
// ============================================================================

export const documentTools = [
  readDocumentConfig,
  readSelectionConfig,
  getMetadataConfig,
  searchDocumentConfig,
  getOutlineConfig
] as const
