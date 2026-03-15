import type { Settings } from '../types'
import { isKnownModel, type LLMProvider as LLMProviderType } from '../../shared/llm/models'

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LLMResponse {
  content: string
  error?: string
}

export interface LLMProvider {
  chat(messages: LLMMessage[]): Promise<LLMResponse>
  stream(messages: LLMMessage[], onChunk: (chunk: string) => void): Promise<void>
}

export interface ValidationResult {
  valid: boolean
  error: string | null
  warnings: string[]
}

/**
 * Validate API key format based on provider.
 * Returns null if valid, error message if invalid.
 */
export function validateApiKeyFormat(provider: LLMProviderType, apiKey: string): string | null {
  // Anthropic requires an API key
  if (provider === 'anthropic') {
    if (!apiKey || !apiKey.trim()) {
      return 'API key is required'
    }
    if (!apiKey.startsWith('sk-ant-')) {
      return 'Anthropic API keys should start with "sk-ant-"'
    }
    if (apiKey.length < 40) {
      return 'Anthropic API key appears to be incomplete'
    }
  }
  return null
}

/**
 * Validate URL format.
 * Returns null if valid, error message if invalid.
 */
export function validateUrl(url: string): string | null {
  if (!url) return null // Empty is OK (uses default)

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'URL must use http or https protocol'
    }
    return null
  } catch {
    return 'Invalid URL format'
  }
}

/**
 * Legacy validation function for backward compatibility.
 * Returns null if valid, error message if invalid.
 */
export function validateConfig(config: Settings['llm']): string | null {
  if (!config.model) {
    return 'No model specified'
  }

  if (!config.apiKey) {
    return 'No API key configured'
  }

  return null
}

/**
 * Comprehensive configuration validation with warnings.
 */
export function validateConfigFull(config: Settings['llm']): ValidationResult {
  const warnings: string[] = []

  // Required: model
  if (!config.model) {
    return { valid: false, error: 'No model specified', warnings }
  }

  // Required: API key
  if (!config.apiKey) {
    return {
      valid: false,
      error: 'No API key configured',
      warnings
    }
  }

  // Validate API key format
  const apiKeyError = validateApiKeyFormat(config.provider, config.apiKey)
  if (apiKeyError) {
    return { valid: false, error: apiKeyError, warnings }
  }

  // Validate base URL if provided
  if (config.baseUrl) {
    const urlError = validateUrl(config.baseUrl)
    if (urlError) {
      return { valid: false, error: `Base URL: ${urlError}`, warnings }
    }
  }

  // Check if model is known (warning only, not an error)
  if (!isKnownModel(config.provider, config.model)) {
    warnings.push(`Unknown model "${config.model}" - this may not work`)
  }

  return { valid: true, error: null, warnings }
}

/**
 * Mask an API key for display, showing only the last 4 characters.
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) return '••••••••'
  return '••••••••' + apiKey.slice(-4)
}

// Stub implementation - will be fully implemented later
export function createLLMProvider(_config: Settings['llm']): LLMProvider {
  return {
    async chat(_messages: LLMMessage[]): Promise<LLMResponse> {
      // TODO: Implement actual LLM calls
      return {
        content: 'LLM integration not yet implemented.',
        error: undefined
      }
    },

    async stream(_messages: LLMMessage[], onChunk: (chunk: string) => void): Promise<void> {
      // TODO: Implement streaming
      onChunk('LLM streaming not yet implemented.')
    }
  }
}
