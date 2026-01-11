/**
 * File tool schemas - tools for file system operations.
 */

import { z } from 'zod'
import type { ToolConfig } from '../types'

// ============================================================================
// open_file
// ============================================================================

export const openFileSchema = z.object({
  path: z.string().describe('Absolute path to the file to open')
})

export const openFileConfig: ToolConfig<typeof openFileSchema> = {
  name: 'open_file',
  description: 'Open a file by path in the editor. Switches the current document.',
  schema: openFileSchema,
  category: 'file',
  requiresMode: null, // Available in all modes
  dangerous: false
}

// ============================================================================
// new_file
// ============================================================================

export const newFileSchema = z.object({
  content: z
    .string()
    .optional()
    .default('')
    .describe('Initial content for the new document')
})

export const newFileConfig: ToolConfig<typeof newFileSchema> = {
  name: 'new_file',
  description: 'Create a new unsaved document. Optionally provide initial content.',
  schema: newFileSchema,
  category: 'file',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// save_file
// ============================================================================

export const saveFileSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Path to save to. If omitted, saves to current path or prompts for new.')
})

export const saveFileConfig: ToolConfig<typeof saveFileSchema> = {
  name: 'save_file',
  description: 'Save the current document. Optionally specify a new path.',
  schema: saveFileSchema,
  category: 'file',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// list_files
// ============================================================================

export const listFilesSchema = z.object({
  path: z.string().describe('Directory path to list'),
  maxDepth: z
    .number()
    .optional()
    .default(1)
    .describe('Maximum depth to recurse (1 = immediate children only)')
})

export const listFilesConfig: ToolConfig<typeof listFilesSchema> = {
  name: 'list_files',
  description: 'List files and directories at the specified path',
  schema: listFilesSchema,
  category: 'file',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// read_file
// ============================================================================

export const readFileSchema = z.object({
  path: z.string().describe('Absolute path to the file to read')
})

export const readFileConfig: ToolConfig<typeof readFileSchema> = {
  name: 'read_file',
  description:
    'Read file contents without opening it in the editor. Useful for referencing other files.',
  schema: readFileSchema,
  category: 'file',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// Export all file tools
// ============================================================================

export const fileTools = [
  openFileConfig,
  newFileConfig,
  saveFileConfig,
  listFilesConfig,
  readFileConfig
] as const
