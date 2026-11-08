import { describe, expect, it } from 'vitest'
import { availableModelsFor, hasProviderKey, validateApiKeyFormat } from './llm'
import { getModelsForProvider } from '../../shared/llm/models'

describe('models by provider (#1242)', () => {
  const live = [{ id: 'gpt-5.1', name: 'gpt-5.1' }]

  it("offers the live list only when it was fetched for the provider in use, else that provider's seed", () => {
    expect(availableModelsFor('openai', live, 'openai')).toBe(live)
    expect(availableModelsFor('anthropic', live, 'openai')).toEqual(getModelsForProvider('anthropic'))
    expect(availableModelsFor('openai', null, null)).toEqual(getModelsForProvider('openai'))
    expect(availableModelsFor('openai', [], 'openai')).toEqual(getModelsForProvider('openai'))
  })

  it('a key counts for the provider in use only', () => {
    const keyStatus = { anthropic: { hint: 'abcd', persisted: true } }
    expect(hasProviderKey({ provider: 'anthropic', model: 'm', keyStatus })).toBe(true)
    expect(hasProviderKey({ provider: 'openai', model: 'm', keyStatus })).toBe(false)
  })

  it("checks a typed key against its provider's format", () => {
    expect(validateApiKeyFormat('openai', 'sk-proj-' + 'x'.repeat(40))).toBeNull()
    expect(validateApiKeyFormat('openai', 'pk-123')).toBe('OpenAI API keys should start with "sk-"')
    expect(validateApiKeyFormat('anthropic', 'sk-proj-' + 'x'.repeat(40))).toBe('Anthropic API keys should start with "sk-ant-"')
  })
})
