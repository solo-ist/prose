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
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: 'Fastest, most economical' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Best balance of speed and intelligence' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', description: 'Most capable model' },
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
  return 'claude-sonnet-4-6'
}

/**
 * Get default Haiku model (used for internal lightweight calls such as
 * API key validation and emoji generation where exact version doesn't matter).
 */
export function getDefaultHaikuModel(): string {
  return 'claude-haiku-4-5-20251001'
}
