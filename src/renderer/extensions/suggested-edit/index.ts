/**
 * Mark-based Suggested Edit Extension
 *
 * Exports the TipTap mark extension and related components for
 * managing inline edit suggestions that track through document changes.
 */

export { SuggestedEdit, suggestedEditPluginKey } from './extension'
export { SuggestionPanel } from './SuggestionPanel'
export type {
  SuggestedEditAttributes,
  SuggestedEditOptions,
  SuggestedEditMeta,
} from './types'
