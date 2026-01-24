/**
 * Known models for each LLM provider.
 * These are used for the model picker dropdown and validation.
 */

export interface ModelInfo {
  id: string
  name: string
  description?: string
}

export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Best balance of speed and intelligence' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most capable model' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Previous generation' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fast and efficient' },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Previous generation flagship' },
]

export const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Latest multimodal model' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Previous flagship' },
  { id: 'gpt-4', name: 'GPT-4', description: 'Original GPT-4' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and cheap' },
  { id: 'o1', name: 'o1', description: 'Reasoning model' },
  { id: 'o1-mini', name: 'o1-mini', description: 'Fast reasoning model' },
  { id: 'o3-mini', name: 'o3-mini', description: 'Latest reasoning model' },
]

export const OPENROUTER_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', description: 'Via OpenRouter' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Via OpenRouter' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'Via OpenRouter' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', description: 'Via OpenRouter' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5', description: 'Via OpenRouter' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', description: 'Via OpenRouter' },
  { id: 'mistralai/mixtral-8x7b-instruct', name: 'Mixtral 8x7B', description: 'Via OpenRouter' },
]

// Ollama models are locally installed, so we provide common defaults
// but allow custom model names
export const OLLAMA_MODELS: ModelInfo[] = [
  { id: 'llama3.2', name: 'Llama 3.2', description: 'Latest Llama' },
  { id: 'llama3.1', name: 'Llama 3.1', description: 'Previous Llama' },
  { id: 'mistral', name: 'Mistral', description: 'Mistral 7B' },
  { id: 'mixtral', name: 'Mixtral', description: 'Mixtral 8x7B' },
  { id: 'codellama', name: 'Code Llama', description: 'Code-focused' },
  { id: 'phi3', name: 'Phi-3', description: 'Microsoft Phi-3' },
  { id: 'gemma2', name: 'Gemma 2', description: 'Google Gemma 2' },
  { id: 'qwen2.5', name: 'Qwen 2.5', description: 'Alibaba Qwen' },
]

export type LLMProvider = 'anthropic' | 'openai' | 'openrouter' | 'ollama'

export function getModelsForProvider(provider: LLMProvider): ModelInfo[] {
  switch (provider) {
    case 'anthropic':
      return ANTHROPIC_MODELS
    case 'openai':
      return OPENAI_MODELS
    case 'openrouter':
      return OPENROUTER_MODELS
    case 'ollama':
      return OLLAMA_MODELS
    default:
      return []
  }
}

/**
 * Check if a model ID is a known model for the provider.
 * For Ollama, we're more permissive since users can have custom models.
 */
export function isKnownModel(provider: LLMProvider, modelId: string): boolean {
  const models = getModelsForProvider(provider)
  return models.some(m => m.id === modelId)
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(provider: LLMProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-sonnet-4-20250514'
    case 'openai':
      return 'gpt-4o'
    case 'openrouter':
      return 'anthropic/claude-sonnet-4'
    case 'ollama':
      return 'llama3.2'
    default:
      return ''
  }
}
