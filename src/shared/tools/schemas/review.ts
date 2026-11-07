/**
 * Review tools (#890): the suggestion lifecycle over the review log (#1233).
 * Agents propose, give feedback, revise and follow the events; the writer
 * accepts or rejects in Prose (#607), so no tool here decides.
 */

import { z } from 'zod'
import type { ToolConfig } from '../types'

export const listSuggestionsSchema = z.object({
  include: z
    .enum(['pending', 'all'])
    .optional()
    .describe('"pending" (default): suggestions still waiting for the writer. "all": also accepted, rejected and superseded ones, from the review history.')
})

export const listSuggestionsConfig: ToolConfig<typeof listSuggestionsSchema> = {
  name: 'list_suggestions',
  description:
    'List the suggestions in the document: id, status, original and suggested text, explanation, who proposed it (by), the feedback on it and the suggestion it revises. The writer accepts or rejects suggestions in Prose; follow their decisions with list_review_events.',
  schema: listSuggestionsSchema,
  category: 'editor',
  requiresMode: null,
  dangerous: false
}

export const replyToSuggestionSchema = z.object({
  id: z.string().describe('ID of a pending suggestion, from list_suggestions or suggest_edit.'),
  text: z.string().min(1).max(5000).describe('The feedback: why the suggestion helps, a question, or what you would change.')
})

export const replyToSuggestionConfig: ToolConfig<typeof replyToSuggestionSchema> = {
  name: 'reply_to_suggestion',
  description:
    'Add feedback to a pending suggestion. The writer sees it with your name in the suggestion history. To change the suggested text itself, use revise_suggestion.',
  schema: replyToSuggestionSchema,
  category: 'editor',
  requiresMode: 'editor',
  dangerous: false
}

export const reviseSuggestionSchema = z.object({
  id: z.string().describe('ID of the pending suggestion to revise.'),
  content: z.string().describe('The new suggested content for the same node, in the form suggest_edit takes.'),
  comment: z.string().optional().describe('Why it changed. Defaults to the original explanation.')
})

export const reviseSuggestionConfig: ToolConfig<typeof reviseSuggestionSchema> = {
  name: 'revise_suggestion',
  description:
    'Replace a pending suggestion with a revised one on the same node. The old suggestion is kept in the history as superseded and linked to the new one; returns the new suggestion id. Typical use: after the writer leaves feedback (see list_review_events).',
  schema: reviseSuggestionSchema,
  category: 'editor',
  requiresMode: 'editor',
  dangerous: false
}

export const getReviewStatusSchema = z.object({})

export const getReviewStatusConfig: ToolConfig<typeof getReviewStatusSchema> = {
  name: 'get_review_status',
  description:
    'Summarize the document review: pending suggestion ids, counts of accepted, rejected and superseded suggestions, open comment threads, and the latest event sequence number (pass it to list_review_events as `since` to hear only what happens next).',
  schema: getReviewStatusSchema,
  category: 'editor',
  requiresMode: null,
  dangerous: false
}

export const listReviewEventsSchema = z.object({
  since: z.number().int().min(0).optional().describe('Return events after this sequence number (default 0: from the start).'),
  limit: z.number().int().min(1).max(500).optional().describe('At most this many events (default 100).')
})

export const listReviewEventsConfig: ToolConfig<typeof listReviewEventsSchema> = {
  name: 'list_review_events',
  description:
    'The review events after a cursor, oldest first: suggestions proposed, revised, accepted, rejected, reopened or given feedback, and comments added, replied to, resolved or reopened, each with who did it (by). Returns nextSeq; call again with since = the last seq to see what the writer did since. Decisions take as long as the writer needs, so poll rather than wait.',
  schema: listReviewEventsSchema,
  category: 'editor',
  requiresMode: null,
  dangerous: false
}

export const reviewTools = [
  listSuggestionsConfig,
  replyToSuggestionConfig,
  reviseSuggestionConfig,
  getReviewStatusConfig,
  listReviewEventsConfig
] as const
