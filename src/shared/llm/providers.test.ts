import { describe, expect, it } from 'vitest'
import { PROVIDERS, PROVIDER_IDS, getProvider, isProvider } from './providers'
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
