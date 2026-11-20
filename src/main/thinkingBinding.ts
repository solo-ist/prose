/**
 * Anthropic binds each thinking block to the conversation that produced it:
 * the system prompt, the tool set and every earlier message (#1289). Prose
 * rebuilds the system prompt on every tool round from the document as it is
 * now, so after an edit tool the prompt has changed and the turn's earlier
 * thinking no longer matches. Accounts created on or after 2026-08-31 get a
 * 400 for that by default.
 *
 * `drop_block` makes the API drop a mismatched block (and every thinking block
 * after it) and carry on, so the turn keeps going without that reasoning
 * instead of failing. It is accepted only alongside adaptive thinking:
 * `between_tools` and `disabled` reject `block_binding`, and a request without
 * a thinking param has nothing to bind.
 */
export const THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01'

export type ThinkingParam =
  | { type: 'adaptive'; display?: 'summarized' | 'omitted' }
  | { type: 'disabled' }
  | { type: 'between_tools' }

export function withThinkingBinding(thinking: ThinkingParam | undefined): {
  thinking?: ThinkingParam & { block_binding?: { prefix_mismatch_behavior: 'drop_block' } }
  headers?: Record<string, string>
} {
  if (thinking?.type !== 'adaptive') return { thinking }
  return {
    thinking: { ...thinking, block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    headers: { 'anthropic-beta': THINKING_BINDING_BETA }
  }
}

/**
 * The thinking blocks the API dropped from a request, from the response's
 * `input_transformations` (present only under the beta header). Entries of
 * other types or reasons are ignored, since later API checks add values.
 */
export function droppedThinking(message: unknown): Array<{ reason: string; path?: string }> {
  const entries = (message as { input_transformations?: unknown } | null)?.input_transformations
  if (!Array.isArray(entries)) return []
  return entries
    .filter((e): e is { type: string; reason: string; path?: string } =>
      !!e && typeof e === 'object' && (e as { type?: unknown }).type === 'thinking_dropped')
    .map((e) => ({ reason: String(e.reason), ...(typeof e.path === 'string' ? { path: e.path } : {}) }))
}
