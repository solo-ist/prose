import { describe, expect, it } from 'vitest'
import { addKeyLabel, availableModelsFor, hasProviderKey, modelGroups, validateApiKeyFormat } from './llm'
import { getModelsForProvider } from '../../shared/llm/models'

describe('models by provider (#1242, #1287)', () => {
  const live = [{ id: 'gpt-5.1', name: 'gpt-5.1' }]

  it("offers a provider's live list once fetched for it, else that provider's seed", () => {
    expect(availableModelsFor('openai', { openai: live })).toBe(live)
    expect(availableModelsFor('anthropic', { openai: live })).toEqual(getModelsForProvider('anthropic'))
    expect(availableModelsFor('openai', {})).toEqual(getModelsForProvider('openai'))
    expect(availableModelsFor('openai', { openai: [] })).toEqual(getModelsForProvider('openai'))
  })

  it('groups every provider in order; one without a key lists no models', () => {
    const keyStatus = { openai: { hint: 'abcd', persisted: true } }
    const groups = modelGroups(keyStatus, { openai: live })
    expect(groups.map((g) => [g.provider, g.label, g.hasKey])).toEqual([
      ['anthropic', 'Anthropic', false],
      ['openai', 'OpenAI', true],
    ])
    expect(groups[0].models).toEqual([])
    expect(groups[1].models).toBe(live)
  })

  it('both keys: both providers list their models side by side', () => {
    const keyStatus = { anthropic: { hint: 'abcd', persisted: true }, openai: { hint: 'efgh', persisted: true } }
    const groups = modelGroups(keyStatus, {})
    expect(groups[0].models).toEqual(getModelsForProvider('anthropic'))
    expect(groups[1].models).toEqual(getModelsForProvider('openai'))
  })

  it('names the call to action with the right article', () => {
    expect(addKeyLabel('OpenAI')).toBe('Add an OpenAI key')
    expect(addKeyLabel('Anthropic')).toBe('Add an Anthropic key')
    expect(addKeyLabel('Inference Coop')).toBe('Add an Inference Coop key')
    expect(addKeyLabel('Mistral')).toBe('Add a Mistral key')
  })

  it('a key counts for the provider asked about, by default the one in use', () => {
    const keyStatus = { anthropic: { hint: 'abcd', persisted: true } }
    expect(hasProviderKey({ provider: 'anthropic', model: 'm', keyStatus })).toBe(true)
    expect(hasProviderKey({ provider: 'openai', model: 'm', keyStatus })).toBe(false)
    expect(hasProviderKey({ provider: 'openai', model: 'm', keyStatus }, 'anthropic')).toBe(true)
  })

  it("checks a typed key against its provider's format", () => {
    expect(validateApiKeyFormat('openai', 'sk-proj-' + 'x'.repeat(40))).toBeNull()
    expect(validateApiKeyFormat('openai', 'pk-123')).toBe('OpenAI API keys should start with "sk-"')
    expect(validateApiKeyFormat('anthropic', 'sk-proj-' + 'x'.repeat(40))).toBe('Anthropic API keys should start with "sk-ant-"')
  })
})
