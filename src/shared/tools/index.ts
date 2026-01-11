/**
 * Unified Tool System
 *
 * This module provides tool definitions shared between:
 * - Internal chat panel (Claude tool_use)
 * - MCP server (external clients like Claude Desktop)
 *
 * Tools are defined once here and consumed by both interfaces.
 */

// Types
export * from './types'

// Schemas
export * from './schemas/document'
export * from './schemas/editor'
export * from './schemas/file'

// Registry
export * from './registry'

// Utils
export { zodToJsonSchema } from './utils'
