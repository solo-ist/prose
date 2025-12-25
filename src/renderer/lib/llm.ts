import type { Settings } from '../types'

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
