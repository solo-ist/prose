/**
 * Tab tool schemas - tools for multi-tab navigation.
 */

import { z } from 'zod'
import type { ToolConfig } from '../types'

// ============================================================================
// list_tabs
// ============================================================================

export const listTabsSchema = z.object({}).describe('No parameters required')

export const listTabsConfig: ToolConfig<typeof listTabsSchema> = {
  name: 'list_tabs',
  description:
    'List all open tabs in the Prose editor. Returns tabId, title, path, isActive, isDirty, isPreview, and documentId for each tab. Call this first when the user references a document by name ("go back to my novel", "switch to the draft") to discover which tab to select.',
  schema: listTabsSchema,
  category: 'document',
  requiresMode: null, // Available in all modes
  dangerous: false
}

// ============================================================================
// select_tab
// ============================================================================

export const selectTabSchema = z.object({
  tabId: z
    .string()
    .optional()
    .describe(
      'The exact tab ID from list_tabs. Preferred over match — use this when you have the ID.'
    ),
  match: z
    .string()
    .optional()
    .describe(
      'Case-insensitive substring to match against tab title and path basename. Use when you only have a partial name. If multiple tabs match, returns an error with candidates. If none match, returns "tab not found".'
    )
})

export const selectTabConfig: ToolConfig<typeof selectTabSchema> = {
  name: 'select_tab',
  description:
    'Switch the active tab in the Prose editor. Accepts either tabId (exact, from list_tabs) or match (case-insensitive substring of title or filename). On ambiguous match, returns candidates so the user can pick. Dismisses any pending suggest_edit diff overlay — same side effect as open_file.',
  schema: selectTabSchema,
  category: 'document',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// Export all tab tools
// ============================================================================

export const tabTools = [listTabsConfig, selectTabConfig] as const
