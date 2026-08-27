/**
 * Core types for the unified tool system.
 * These types are shared between main process (MCP server) and renderer (chat tools).
 */

import type { z } from 'zod'

/**
 * Tool execution modes that control which tools are available.
 *
 * - `chat`   — read-only. Sounding board / fact-check; agent cannot mutate the doc.
 * - `editor` — propose copy edits via suggest_edit, leave editorial notes via add_comment. Default. No direct writes.
 * - `create` — opt-in. Drafting allowed (`edit` / `insert` available). User has explicitly lifted the no-authorship rule.
 *
 * Renamed from `suggestions` / `plan` / `full` in #467 Chunk 3. `toolMode`
 * is in-memory only — `chatStore` does not use Zustand's `persist` middleware
 * and `ChatConversation` does not carry `toolMode`. Each session re-initializes
 * to the chatStore default, so no migration is needed.
 */
export type ToolMode = 'chat' | 'editor' | 'create'

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
 * The surface that initiated a tool call.  This is deliberately separate from
 * ToolMode: an MCP call currently runs through the renderer in Create mode, but
 * still needs an origin so review mutations can attribute the actor from the
 * trusted bridge rather than from user-supplied arguments.
 */
export type ToolOrigin = 'ui' | 'chat' | 'mcp'

/** Stable actor class used by review comments, suggestions, and events. */
export type ReviewActor = 'human' | 'assistant' | 'system'

/**
 * Provenance attached to review state.  The legacy `author: 'user' | 'ai'`
 * fields remain in comment/suggestion records for compatibility; this richer
 * shape is additive and is populated by the execution context.
 */
export interface ReviewAttribution {
  actor: ReviewActor
  origin: ToolOrigin
  actorId?: string
  label?: string
  provider?: string
  model?: string
  conversationId?: string
  messageId?: string
  requestId?: string
}

/** Trusted context supplied by the host of a tool call. */
export interface ToolExecutionContext {
  origin: ToolOrigin
  attribution: ReviewAttribution
  requestId?: string
  /**
   * Document identity captured by the trusted host before dispatch. MCP
   * mutations use this to reject a call if the active tab changes while the
   * renderer is awaiting persistence.
   */
  expectedDocumentId?: string
}

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
  commentCount: number
  annotationCount: number
  pendingSuggestionCount: number
  createdAt: string | null
  modifiedAt: string | null
  fileSize: number | null
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
