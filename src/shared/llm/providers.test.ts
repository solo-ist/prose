import { describe, expect, it } from 'vitest'
import { PROVIDERS, PROVIDER_IDS, chatCompletionsTuning, getProvider, isOpenAIReasoningModel, isProvider, reasonsOverResponses } from './providers'
import { getDefaultHaikuModel, getDefaultModel, getModelsForProvider, getSmallModel, isKnownModel, resolveModelName, supportsThinkingToggle } from './models'

describe('provider list (#1240)', () => {
  it('has Anthropic, keyed under its pre-1.9.1 credential name, and OpenAI with its own key', () => {
    expect(PROVIDER_IDS).toEqual(['anthropic', 'openai'])
    expect(PROVIDERS.anthropic.credentialKey).toBe('llm-api-key')
    expect(PROVIDERS.anthropic.transport).toBe('anthropic')
    expect(PROVIDERS.openai.transport).toBe('responses')
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

/** A Chat Completions provider as the co-op will be (A3, #956): OpenAI itself speaks Responses since #1301. */
const gateway = (reasoningEffortFor: (model: string) => string | undefined) => ({
  ...PROVIDERS.openai,
  transport: 'chat-completions' as const,
  chatCompletions: { reasoningEffortFor, reasoningHeadroom: 8000 },
})

describe('Chat Completions tuning (#1271)', () => {
  it('a model with a reasoning effort gets it and room for the reasoning; others get neither', () => {
    const provider = gateway((model) => (isOpenAIReasoningModel(model) ? 'low' : undefined))
    expect(chatCompletionsTuning(provider, 'gpt-5', 16000)).toEqual({ reasoningEffort: 'low', maxTokens: 24000 })
    expect(chatCompletionsTuning(provider, 'o4-mini', 16000)).toEqual({ reasoningEffort: 'low', maxTokens: 24000 })
    expect(chatCompletionsTuning(provider, 'gpt-4.1', 16000)).toEqual({ maxTokens: 16000 })
    expect(chatCompletionsTuning(provider, 'gpt-5-chat-latest', 16000)).toEqual({ maxTokens: 16000 })
    // The summary path sends no limit.
    expect(chatCompletionsTuning(provider, 'gpt-5')).toEqual({ reasoningEffort: 'low' })
  })

  it('a provider that answers none (the co-op, A3) sends it and adds no headroom; other transports send nothing', () => {
    expect(chatCompletionsTuning(gateway(() => 'none'), 'tinfoil/glm-5.3', 16000)).toEqual({ reasoningEffort: 'none', maxTokens: 16000 })
    expect(chatCompletionsTuning(PROVIDERS.anthropic, 'claude-sonnet-5-5', 16000)).toEqual({ maxTokens: 16000 })
    expect(chatCompletionsTuning(PROVIDERS.openai, 'gpt-5', 16000)).toEqual({ maxTokens: 16000 })
  })
})

describe('OpenAI over the Responses API (#1301)', () => {
  it('OpenAI speaks Responses; Anthropic its own API', () => {
    expect(PROVIDERS.openai.transport).toBe('responses')
    expect(PROVIDERS.anthropic.transport).toBe('anthropic')
  })

  it('reasoning models are told apart by id, a family not yet named included', () => {
    expect(['gpt-5', 'gpt-5.1', 'gpt-5-nano', 'gpt-5.5', 'gpt-6-sol', 'o3', 'o4-mini'].every(isOpenAIReasoningModel)).toBe(true)
    expect(['gpt-4.1', 'gpt-4o-mini', 'gpt-5-chat-latest', 'chatgpt-4o-latest'].some(isOpenAIReasoningModel)).toBe(false)
  })

  it('the first guess at the lowest effort: minimal for the first gpt-5 generation, none after', () => {
    const off = PROVIDERS.openai.responses!.offEffort
    expect(['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-2025-08-07'].map(off)).toEqual(['minimal', 'minimal', 'minimal', 'minimal'])
    expect(['gpt-5.1', 'gpt-5.5', 'gpt-6-sol', 'o4-mini'].map(off)).toEqual(['none', 'none', 'none', 'none'])
  })

  it('the thinking toggle shows for Claude models that think and OpenAI models that reason', () => {
    expect(supportsThinkingToggle('anthropic', 'claude-sonnet-5-5')).toBe(true)
    expect(supportsThinkingToggle('anthropic', 'claude-haiku-4-5')).toBe(false)
    expect(supportsThinkingToggle('openai', 'gpt-5')).toBe(true)
    expect(supportsThinkingToggle('openai', 'gpt-6-sol')).toBe(true)
    expect(supportsThinkingToggle('openai', 'gpt-4.1')).toBe(false)
    expect(reasonsOverResponses('anthropic', 'gpt-5')).toBe(false)
    expect(reasonsOverResponses('nope', 'gpt-5')).toBe(false)
  })
})
