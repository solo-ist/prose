import { describe, expect, it } from 'vitest'
import { addKeyLabel, availableModelsFor, hasProviderKey, modelGroups, pickerModelsFor, shownModelIds, validateApiKeyFormat } from './llm'
import { getModelsForProvider } from '../../shared/llm/models'
import { getProvider } from '../../shared/llm/providers'

describe('models by provider (#1242, #1287)', () => {
  const live = [{ id: 'gpt-5.1', name: 'gpt-5.1' }]
  const ids = (models: Array<{ id: string }>) => models.map((m) => m.id)
  const inUse = { provider: 'anthropic' as const, model: 'claude-sonnet-5-5' }

  it("offers a provider's live list once fetched for it, else that provider's seed", () => {
    expect(ids(availableModelsFor('openai', { openai: live }))).toEqual(['gpt-5.1'])
    expect(ids(availableModelsFor('anthropic', { openai: live }))).toEqual(ids(getModelsForProvider('anthropic')))
    expect(ids(availableModelsFor('openai', {}))).toEqual(ids(getModelsForProvider('openai')))
    expect(ids(availableModelsFor('openai', { openai: [] }))).toEqual(ids(getModelsForProvider('openai')))
  })

  it('names every model by the one scheme: long for menus, short for the status bar (#1322)', () => {
    const [terra] = availableModelsFor('openai', { openai: [{ id: 'gpt-6.1-terra', name: 'gpt-6.1-terra' }] })
    expect(terra).toMatchObject({ id: 'gpt-6.1-terra', name: 'OpenAI Terra 6.1', shortName: 'Terra 6.1' })
    expect(availableModelsFor('anthropic', {}).find((m) => m.id === 'claude-sonnet-5-5')).toMatchObject({ name: 'Claude Sonnet 5.5', shortName: 'Sonnet 5.5' })
  })

  it('groups every provider in order; one without a key lists no models', () => {
    const keyStatus = { openai: { hint: 'abcd', persisted: true } }
    const groups = modelGroups({ ...inUse, keyStatus }, { openai: live })
    expect(groups.map((g) => [g.provider, g.label, g.hasKey])).toEqual([
      ['anthropic', 'Anthropic', false],
      ['openai', 'OpenAI', true],
      ['inference-coop', 'Inference Coop', false],
    ])
    expect(groups[0].models).toEqual([])
    expect(groups[0].allModels).toEqual([])
    // None of OpenAI's flagships is on offer, so the picker lists what is.
    expect(ids(groups[1].models)).toEqual(['gpt-5.1'])
  })

  it('both keys: both providers list their models side by side', () => {
    const keyStatus = { anthropic: { hint: 'abcd', persisted: true }, openai: { hint: 'efgh', persisted: true } }
    const groups = modelGroups({ ...inUse, keyStatus }, {})
    expect(ids(groups[0].allModels)).toEqual(ids(getModelsForProvider('anthropic')))
    expect(ids(groups[1].allModels)).toEqual(ids(getModelsForProvider('openai')))
  })

  describe('the shown set (#1322)', () => {
    const coop = [
      'deepseek-flash-green', 'greenpt/deepseek-v4.1-flash', 'greenpt/glm-5.3-flash', 'regolo/apertus-70b', 'regolo/gemma4-31b',
      'regolo/mistral-small-4-119b', 'regolo/qwen3.5-122b', 'tinfoil/deepseek-v4-1-flash', 'tinfoil/glm-5.3', 'tinfoil/gpt-oss-120b',
    ].map((id) => ({ id, name: id }))
    const liveCoop = { 'inference-coop': coop }

    it("pickers list a provider's flagships, in their order, until the writer chooses", () => {
      expect(ids(pickerModelsFor('inference-coop', liveCoop, inUse))).toEqual([
        'tinfoil/deepseek-v4-1-flash', 'tinfoil/glm-5.3', 'greenpt/deepseek-v4.1-flash', 'regolo/qwen3.5-122b', 'regolo/gemma4-31b', 'regolo/apertus-70b',
      ])
      expect(shownModelIds('inference-coop', {})).toEqual(getProvider('inference-coop').featuredModels)
    })

    it("the writer's set replaces the flagships for that provider only", () => {
      const llm = { ...inUse, shownModels: { 'inference-coop': ['tinfoil/gpt-oss-120b', 'tinfoil/glm-5.3'] } }
      expect(ids(pickerModelsFor('inference-coop', liveCoop, llm))).toEqual(['tinfoil/gpt-oss-120b', 'tinfoil/glm-5.3'])
      expect(shownModelIds('openai', llm)).toEqual(getProvider('openai').featuredModels)
    })

    it('the model in use is always listed; an empty or stale set lists everything', () => {
      const using = { provider: 'inference-coop' as const, model: 'regolo/mistral-small-4-119b' }
      expect(ids(pickerModelsFor('inference-coop', liveCoop, using))).toContain('regolo/mistral-small-4-119b')
      expect(ids(pickerModelsFor('inference-coop', liveCoop, inUse))).not.toContain('regolo/mistral-small-4-119b')
      expect(pickerModelsFor('inference-coop', liveCoop, { ...inUse, shownModels: { 'inference-coop': [] } })).toHaveLength(coop.length)
      expect(pickerModelsFor('inference-coop', liveCoop, { ...inUse, shownModels: { 'inference-coop': ['gone/model'] } })).toHaveLength(coop.length)
    })

    it('a group carries both: what the pickers list and everything on offer', () => {
      const keyStatus = { 'inference-coop': { hint: 'abcd', persisted: true } }
      const group = modelGroups({ ...inUse, keyStatus }, liveCoop)[2]
      expect(group.models).toHaveLength(6)
      expect(group.allModels).toHaveLength(coop.length)
      expect(group.models[0].name).toBe('Tinfoil DeepSeek 4.1')
    })
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
