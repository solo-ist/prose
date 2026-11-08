import { describe, expect, it } from 'vitest'
import { PROVIDERS, PROVIDER_IDS, chatCompletionsTuning, getProvider, isOpenAIReasoningModel, isProvider } from './providers'
import { getDefaultHaikuModel, getDefaultModel, getModelsForProvider, getSmallModel, isKnownModel, resolveModelName } from './models'

describe('provider list (#1240)', () => {
  it('has Anthropic, keyed under its pre-1.9.1 credential name, and OpenAI over Chat Completions with its own key', () => {
    expect(PROVIDER_IDS).toEqual(['anthropic', 'openai'])
    expect(PROVIDERS.anthropic.credentialKey).toBe('llm-api-key')
    expect(PROVIDERS.anthropic.transport).toBe('anthropic')
    expect(PROVIDERS.openai.transport).toBe('chat-completions')
    expect(PROVIDERS.openai.credentialKey).not.toBe(PROVIDERS.anthropic.credentialKey)
    expect(PROVIDERS.openai.thinking).toBe(false)
    expect(getModelsForProvider('openai').map((m) => m.id)).toContain(getDefaultModel('openai'))
    expect(resolveModelName('gpt-5-mini')).toBe('GPT-5 mini')
  })

  it('the model helpers read the entry', () => {
    expect(getModelsForProvider('anthropic')).toBe(PROVIDERS.anthropic.models)
    expect(getDefaultModel('anthropic')).toBe(PROVIDERS.anthropic.defaultModel)
    expect(getSmallModel('anthropic')).toBe(PROVIDERS.anthropic.smallModel)
    expect(getDefaultHaikuModel()).toBe(PROVIDERS.anthropic.smallModel)
    expect(isKnownModel('anthropic', PROVIDERS.anthropic.defaultModel)).toBe(true)
    expect(resolveModelName(PROVIDERS.anthropic.defaultModel)).toBe('Claude Sonnet 5.5')
  })

  it('an unknown id is not a provider and resolves to the default entry', () => {
    expect(isProvider('anthropic')).toBe(true)
    expect(isProvider('openai')).toBe(true)
    expect(isProvider('openrouter')).toBe(false)
    expect(isProvider('__proto__')).toBe(false)
    expect(isProvider(undefined)).toBe(false)
    expect(getProvider('nope')).toBe(PROVIDERS.anthropic)
  })
})

describe('Chat Completions tuning (#1271)', () => {
  it("OpenAI's reasoning models get a low effort and room for the reasoning; others get neither", () => {
    expect(chatCompletionsTuning(PROVIDERS.openai, 'gpt-5', 16000)).toEqual({ reasoningEffort: 'low', maxTokens: 24000 })
    expect(chatCompletionsTuning(PROVIDERS.openai, 'gpt-5-mini', 16000)).toEqual({ reasoningEffort: 'low', maxTokens: 24000 })
    expect(chatCompletionsTuning(PROVIDERS.openai, 'o4-mini', 16000)).toEqual({ reasoningEffort: 'low', maxTokens: 24000 })
    expect(chatCompletionsTuning(PROVIDERS.openai, 'gpt-4.1', 16000)).toEqual({ maxTokens: 16000 })
    expect(chatCompletionsTuning(PROVIDERS.openai, 'gpt-5-chat-latest', 16000)).toEqual({ maxTokens: 16000 })
    // The summary path sends no limit.
    expect(chatCompletionsTuning(PROVIDERS.openai, 'gpt-5')).toEqual({ reasoningEffort: 'low' })
  })

  it('a provider that answers none (the co-op, A3) sends it and adds no headroom; Anthropic sends nothing', () => {
    const coop = { ...PROVIDERS.openai, chatCompletions: { reasoningEffortFor: () => 'none', reasoningHeadroom: 8000 } }
    expect(chatCompletionsTuning(coop, 'tinfoil/glm-5.3', 16000)).toEqual({ reasoningEffort: 'none', maxTokens: 16000 })
    expect(chatCompletionsTuning(PROVIDERS.anthropic, 'claude-sonnet-5-5', 16000)).toEqual({ maxTokens: 16000 })
  })

  it('reasoning models are told apart by id', () => {
    expect(['gpt-5', 'gpt-5.1', 'gpt-5-nano', 'o3', 'o4-mini'].every(isOpenAIReasoningModel)).toBe(true)
    expect(['gpt-4.1', 'gpt-4o-mini', 'gpt-5-chat-latest', 'chatgpt-4o-latest'].some(isOpenAIReasoningModel)).toBe(false)
  })
})
