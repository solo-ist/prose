/**
 * Known models for the LLM provider.
 * These are used for the model picker dropdown and validation.
 */

export interface ModelInfo {
  id: string
  name: string
  description?: string
}

export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fastest, most economical' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', description: 'Best balance of speed and intelligence' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', description: 'Most capable model' },
]

export type LLMProvider = 'anthropic'

export function getModelsForProvider(_provider: LLMProvider): ModelInfo[] {
  return ANTHROPIC_MODELS
}

/**
 * Check if a model ID is a known model.
 */
export function isKnownModel(_provider: LLMProvider, modelId: string): boolean {
  return ANTHROPIC_MODELS.some(m => m.id === modelId)
}

/**
 * Get default model
 */
export function getDefaultModel(_provider: LLMProvider): string {
  return 'claude-sonnet-5-5'
}

/**
 * Get default Haiku model (used for internal lightweight calls such as
 * API key validation and emoji generation where exact version doesn't matter).
 */
export function getDefaultHaikuModel(): string {
  return 'claude-haiku-4-5'
}

/**
 * Model IDs that support the adaptive thinking API
 * (`thinking: {type: "adaptive", display: "summarized"}`).
 * Sonnet 4.6+, Opus 4.6+, and Fable 5+ support it.
 * Haiku 4.5 and older Sonnets (4.5/4.0) do NOT — sending the param
 * returns HTTP 400 on those models.
 *
 * Matching is `startsWith`, so a base prefix covers its point releases:
 * `claude-sonnet-5` covers `claude-sonnet-5-5`, and so on.
 */
const THINKING_CAPABLE_PREFIXES = [
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-fable-5',
]

export function supportsAdaptiveThinking(modelId: string): boolean {
  return THINKING_CAPABLE_PREFIXES.some(prefix => modelId.startsWith(prefix))
}

/**
 * How extended thinking is turned OFF for a given model.
 *
 * The off-switch is not uniform across generations, and getting it wrong is a
 * hard HTTP 400 at request time:
 *
 * - `'omit'` — send no `thinking` param at all. The only accepted form on
 *   Opus 5.5 and Fable 5.x, which reject `{type: 'disabled'}` at every effort
 *   level. Thinking is on by default on those models, so this reduces depth
 *   (via `output_config.effort`) rather than suppressing thinking outright.
 * - `'between_tools'` — Sonnet 5.5's replacement for `'disabled'`. Valid only
 *   at effort `high` or below and only on its own: no `display`,
 *   `budget_tokens` or `block_binding` alongside it. Rejected by every other
 *   model.
 * - `'disabled'` — `{type: 'disabled'}`, still accepted by Sonnet 4.6 and
 *   Opus 4.6/4.7/4.8.
 *
 * Only meaningful for models where `supportsAdaptiveThinking()` is true —
 * models outside that list must omit the param whether thinking is on or off.
 */
export type ThinkingOffMode = 'omit' | 'disabled' | 'between_tools'

/**
 * Model id → off-mode. Matched **exactly**, not by prefix, because the off-
 * switch changes between point releases of the same family: `claude-sonnet-5`
 * takes `disabled` while `claude-sonnet-5-5` rejects it, and `claude-opus-5`
 * takes `disabled` while `claude-opus-5-5` rejects every explicit off-switch.
 * A prefix rule would silently hand the wrong form to the next point release.
 *
 * `'disabled'` is therefore an allowlist, and anything unlisted — a model that
 * shipped after this build, or an id typed into the custom-model field —
 * resolves to `'omit'`, the only form valid on every model. The cost of that
 * default is that thinking may stay on when the user asked for it off; the
 * cost of guessing wrong in either other direction is a hard 400 on every
 * request.
 */
const THINKING_OFF_MODES: Record<string, ThinkingOffMode> = {
  // 5.x — reject `{type: 'disabled'}`
  'claude-sonnet-5-5': 'between_tools',
  'claude-opus-5-5': 'omit',
  'claude-fable-5': 'omit',
  'claude-fable-5-1': 'omit',
  // Still accept `{type: 'disabled'}` (Opus 5 at effort 'high' or below,
  // which is what we send).
  'claude-sonnet-4-6': 'disabled',
  'claude-sonnet-5': 'disabled',
  'claude-opus-4-6': 'disabled',
  'claude-opus-4-7': 'disabled',
  'claude-opus-4-8': 'disabled',
  'claude-opus-5': 'disabled',
}

export function getThinkingOffMode(modelId: string): ThinkingOffMode {
  // A dated alias (claude-haiku-4-5-20251001) resolves like its base id.
  const base = modelId.replace(/-\d{8}$/, '')
  return THINKING_OFF_MODES[base] ?? 'omit'
}

/**
 * Resolve a model ID to its human-readable display name. Prefers the live-fetched
 * list (which the provider updates as new models ship), falls back to the static
 * seed, and finally to the raw model ID.
 */
export function resolveModelName(
  modelId: string,
  fetched?: ModelInfo[] | null
): string {
  const fromFetched = fetched?.find((m) => m.id === modelId)?.name
  if (fromFetched) return fromFetched
  const fromStatic = ANTHROPIC_MODELS.find((m) => m.id === modelId)?.name
  return fromStatic || modelId
}
