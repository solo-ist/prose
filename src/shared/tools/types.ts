/**
 * Core types for the unified tool system.
 * These types are shared between main process (MCP server) and renderer (chat tools).
 */

import type { z } from 'zod'

/**
 * Tool execution modes that control which tools are available.
 */
export type ToolMode = 'suggestions' | 'full' | 'plan'

/**
 * Tool categories for organization and filtering.
 */
export type ToolCategory = 'document' | 'editor' | 'file' | 'ui' | 'annotations' | 'chat'

/**
 * Successful tool execution result.
 */
export interface ToolSuccess<T = unknown> {
  success: true
  data: T
}

/**
 * Failed tool execution result.
 */
export interface ToolError {
  success: false
  error: string
  code?: string
}

/**
 * Union type for tool results.
 */
export type ToolResult<T = unknown> = ToolSuccess<T> | ToolError

/**
 * Helper to create a success result.
 */
export function toolSuccess<T>(data: T): ToolSuccess<T> {
  return { success: true, data }
}

/**
 * Helper to create an error result.
 */
export function toolError(error: string, code?: string): ToolError {
  return { success: false, error, code }
}

/**
 * Configuration for a single tool.
 */
export interface ToolConfig<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Unique tool name (e.g., 'read_document', 'edit') */
  name: string
  /** Human-readable description for LLM and docs */
  description: string
  /** Zod schema for input validation */
  schema: TSchema
  /** Tool category for organization */
  category: ToolCategory
  /** Minimum mode required to use this tool (null = available in all modes) */
  requiresMode: ToolMode | null
  /** Whether the tool makes destructive changes requiring confirmation */
  dangerous: boolean
}

/**
 * Infer the input type from a tool config.
 */
export type ToolInput<T extends ToolConfig> = z.infer<T['schema']>

/**
 * Position in document (line/column, 1-indexed).
 */
export interface Position {
  line: number
  column: number
}

/**
 * Range in document (start/end positions).
 */
export interface Range {
  start: Position
  end: Position
}

/**
 * Text match result with position information.
 */
export interface TextMatch {
  text: string
  range: Range
  index: number
}

/**
 * Document metadata.
 */
export interface DocumentMetadata {
  documentId: string
  path: string | null
  wordCount: number
  characterCount: number
  lineCount: number
  frontmatter: Record<string, unknown>
  isDirty: boolean
}

/**
 * Document outline entry (heading).
 */
export interface OutlineEntry {
  level: number
  text: string
  line: number
}

/**
 * File item for directory listings.
 */
export interface FileItem {
  name: string
  path: string
  isDirectory: boolean
  children?: FileItem[]
}

/**
 * Diff suggestion info.
 */
export interface DiffSuggestion {
  id: string
  originalText: string
  suggestedText: string
  comment?: string
}
