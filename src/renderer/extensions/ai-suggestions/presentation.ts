import type { ReviewActor } from '../review-events'

/** The attribution and rationale fields shared by live and historical items. */
export interface SuggestionPresentationInput {
  humanInline?: boolean
  provenanceSource?: 'ui' | 'chat' | 'mcp' | 'system' | 'unknown'
  provenanceModel?: string
  explanation?: string
  createdBy?: Pick<ReviewActor, 'kind' | 'source' | 'model'>
}

/** Whether this is an ordinary local edit captured from the human editor. */
export function isLocalHumanSuggestion(suggestion: SuggestionPresentationInput): boolean {
  const source = suggestion.provenanceSource ?? suggestion.createdBy?.source
  const model = suggestion.provenanceModel?.trim() || suggestion.createdBy?.model?.trim()

  if (suggestion.createdBy?.kind === 'user') return true
  return suggestion.humanInline === true
    && (!source || source === 'ui')
    && (!model || model === 'Human')
}

/** The short author label shown beside a review item. */
export function suggestionAuthorLabel(suggestion: SuggestionPresentationInput): string {
  if (isLocalHumanSuggestion(suggestion)) return 'You'

  const model = suggestion.provenanceModel?.trim() || suggestion.createdBy?.model?.trim()
  if (model) return model
  if (suggestion.createdBy?.kind === 'user') return 'You'
  if (suggestion.provenanceSource === 'mcp') return 'MCP'
  return 'Prose'
}

/** Return a rationale only when it contains meaningful supplied text. */
export function suggestionExplanation(
  suggestion: SuggestionPresentationInput,
): string | undefined {
  const explanation = suggestion.explanation?.trim()
  return explanation || undefined
}
