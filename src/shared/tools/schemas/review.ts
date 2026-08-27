/**
 * Review-collaboration tool schemas.
 *
 * These tools intentionally keep comment threads and AI suggestions as two
 * separate domains.  The renderer joins them only in read-only status/event
 * views; a comment operation can never change suggestion status and vice
 * versa.
 */

import { z } from 'zod'
import type { ToolConfig } from '../types'

const suggestionStatus = z.enum([
  'pending',
  'accepted',
  'rejected',
  'superseded',
  'all'
])

// ============================================================================
// list_suggestions
// ============================================================================

export const listSuggestionsSchema = z.object({
  status: suggestionStatus
    .optional()
    .default('pending')
    .describe('Filter suggestions by lifecycle status. Defaults to pending.'),
  includeFeedback: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include structured feedback entries on each suggestion.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe('Maximum number of suggestions to return.')
})

export const listSuggestionsConfig: ToolConfig<typeof listSuggestionsSchema> = {
  name: 'list_suggestions',
  description:
    'List AI review suggestions for the active document. Returns pending suggestions by default, with lifecycle status, feedback, attribution, and revision links. Use this before feedback, revision, or an explicit decision.',
  schema: listSuggestionsSchema,
  category: 'annotations',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// add_suggestion_feedback
// ============================================================================

export const addSuggestionFeedbackSchema = z.object({
  id: z.string().min(1).describe('ID of the suggestion to annotate. Get IDs from list_suggestions.'),
  text: z.string().min(1).describe('Feedback explaining what should change in the suggestion.')
})

export const addSuggestionFeedbackConfig: ToolConfig<typeof addSuggestionFeedbackSchema> = {
  name: 'add_suggestion_feedback',
  description:
    'Add feedback to a pending AI suggestion without accepting or rejecting it. Feedback is append-only and can be used to drive revise_suggestion.',
  schema: addSuggestionFeedbackSchema,
  category: 'annotations',
  requiresMode: 'editor',
  dangerous: false
}

// ============================================================================
// revise_suggestion
// ============================================================================

export const reviseSuggestionSchema = z.object({
  id: z.string().min(1).describe('ID of the pending suggestion to revise. Get IDs from list_suggestions.'),
  content: z.string().describe('The complete replacement text for the revised suggestion.'),
  comment: z.string().optional().describe('Brief explanation shown with the revised suggestion.')
})

export const reviseSuggestionConfig: ToolConfig<typeof reviseSuggestionSchema> = {
  name: 'revise_suggestion',
  description:
    'Create a new pending suggestion that supersedes an existing suggestion. The original suggestion and its feedback remain in review history; the returned suggestionId identifies the new revision.',
  schema: reviseSuggestionSchema,
  category: 'annotations',
  requiresMode: 'editor',
  dangerous: false
}

// ============================================================================
// decide_suggestion
// ============================================================================

export const decideSuggestionSchema = z.object({
  id: z.string().min(1).describe('ID of exactly one pending suggestion. Get IDs from list_suggestions.'),
  decision: z
    .enum(['accept', 'reject'])
    .describe('The explicit decision for this one suggestion.')
})

export const decideSuggestionConfig: ToolConfig<typeof decideSuggestionSchema> = {
  name: 'decide_suggestion',
  description:
    'Accept or reject exactly one pending AI suggestion by ID. The decision is recorded as a review event and the result includes its eventId.',
  schema: decideSuggestionSchema,
  category: 'annotations',
  requiresMode: 'editor',
  dangerous: false
}

// ============================================================================
// list_review_events
// ============================================================================

export const listReviewEventsSchema = z.object({
  targetType: z
    .enum(['comment', 'suggestion'])
    .optional()
    .describe('Restrict events to one review domain.'),
  targetId: z.string().min(1).optional().describe('Restrict events to one comment or suggestion ID.'),
  eventType: z.string().min(1).optional().describe('Restrict events to one lifecycle event type.'),
  after: z.number().int().nonnegative().optional().describe('Return events created after this epoch-millisecond timestamp.'),
  limit: z.number().int().min(1).max(500).optional().default(100).describe('Maximum number of events to return.')
})

export const listReviewEventsConfig: ToolConfig<typeof listReviewEventsSchema> = {
  name: 'list_review_events',
  description:
    'List immutable review lifecycle and decision events for the active document. Events include trusted attribution and target IDs for comments and suggestions.',
  schema: listReviewEventsSchema,
  category: 'annotations',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// get_review_status
// ============================================================================

export const getReviewStatusSchema = z.object({}).describe('No parameters required')

export const getReviewStatusConfig: ToolConfig<typeof getReviewStatusSchema> = {
  name: 'get_review_status',
  description:
    'Return separate aggregate status counts for comment threads and AI suggestions in the active document, plus the latest review-event timestamp.',
  schema: getReviewStatusSchema,
  category: 'annotations',
  requiresMode: null,
  dangerous: false
}

export const reviewTools = [
  listSuggestionsConfig,
  addSuggestionFeedbackConfig,
  reviseSuggestionConfig,
  decideSuggestionConfig,
  listReviewEventsConfig,
  getReviewStatusConfig
] as const

