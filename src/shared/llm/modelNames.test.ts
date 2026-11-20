import { describe, expect, it } from 'vitest'
import { modelNames } from './modelNames'
import { PROVIDERS, PROVIDER_IDS } from './providers'
import { resolveModelName } from './models'

describe('model names (#1322)', () => {
  it('Claude: the family and version, with Claude in front in menus', () => {
    expect(modelNames('anthropic', 'claude-sonnet-5-5')).toEqual({ short: 'Sonnet 5.5', long: 'Claude Sonnet 5.5' })
    expect(modelNames('anthropic', 'claude-fable-5-2')).toEqual({ short: 'Fable 5.2', long: 'Claude Fable 5.2' })
    expect(modelNames('anthropic', 'claude-opus-5')).toEqual({ short: 'Opus 5', long: 'Claude Opus 5' })
    // A dated id reads like its base.
    expect(modelNames('anthropic', 'claude-haiku-4-5-20251001').short).toBe('Haiku 4.5')
    // An id the rule doesn't fit keeps the provider's display name.
    expect(modelNames('anthropic', 'claude-3-5-sonnet-20241022', 'Claude Sonnet 3.5')).toEqual({ short: 'Sonnet 3.5', long: 'Claude Sonnet 3.5' })
  })

  it('OpenAI: a named line leads with its name, the base model with GPT', () => {
    expect(modelNames('openai', 'gpt-5.5')).toEqual({ short: 'GPT 5.5', long: 'OpenAI GPT 5.5' })
    expect(modelNames('openai', 'gpt-5.6-luna')).toEqual({ short: 'Luna 5.6', long: 'OpenAI Luna 5.6' })
    expect(modelNames('openai', 'gpt-6.1-sol')).toEqual({ short: 'Sol 6.1', long: 'OpenAI Sol 6.1' })
    expect(modelNames('openai', 'gpt-6.1-terra').long).toBe('OpenAI Terra 6.1')
    expect(modelNames('openai', 'gpt-6-astra').short).toBe('Astra 6')
    // A size is not a line; a custom id stays as typed.
    expect(modelNames('openai', 'gpt-5-mini').short).toBe('GPT 5 Mini')
    expect(modelNames('openai', 'o4-mini')).toEqual({ short: 'o4-mini', long: 'o4-mini' })
  })

  it('Inference Coop: the model, with its host in front in menus', () => {
    expect(modelNames('inference-coop', 'regolo/apertus-70b')).toEqual({ short: 'Apertus 70b', long: 'Regolo Apertus 70b' })
    expect(modelNames('inference-coop', 'regolo/qwen3.5-122b')).toEqual({ short: 'Qwen 3.5 122b', long: 'Regolo Qwen 3.5 122b' })
    expect(modelNames('inference-coop', 'regolo/gemma4-31b').long).toBe('Regolo Gemma 4 31b')
    expect(modelNames('inference-coop', 'tinfoil/glm-5.3')).toEqual({ short: 'GLM 5.3', long: 'Tinfoil GLM 5.3' })
    expect(modelNames('inference-coop', 'greenpt/deepseek-v4.1-flash')).toEqual({ short: 'DeepSeek 4.1', long: 'GreenPT DeepSeek 4.1' })
    expect(modelNames('inference-coop', 'tinfoil/deepseek-v4-1-flash').long).toBe('Tinfoil DeepSeek 4.1')
    expect(modelNames('inference-coop', 'greenpt/glm-5.3-flash').short).toBe('GLM 5.3 Flash')
    // A model and a host no table knows are spelled out; an alias has no host.
    expect(modelNames('inference-coop', 'newhost/some-model-9b')).toEqual({ short: 'Some Model 9b', long: 'Newhost Some Model 9b' })
    expect(modelNames('inference-coop', 'glm-tee')).toEqual({ short: 'GLM TEE', long: 'GLM TEE' })
  })

  it('every seed model is listed under the name the scheme gives it', () => {
    for (const provider of PROVIDER_IDS) {
      for (const model of PROVIDERS[provider].models) {
        expect(model.name).toBe(modelNames(provider, model.id).long)
      }
    }
  })

  it("every provider's default model is one of its flagships", () => {
    for (const provider of PROVIDER_IDS) {
      expect(PROVIDERS[provider].featuredModels).toContain(PROVIDERS[provider].defaultModel)
    }
  })

  it('authorship labels use the long name, with or without the provider named', () => {
    expect(resolveModelName('gpt-5.5')).toBe('OpenAI GPT 5.5')
    expect(resolveModelName('gpt-6.1-terra', [{ id: 'gpt-6.1-terra', name: 'gpt-6.1-terra' }], 'openai')).toBe('OpenAI Terra 6.1')
    expect(resolveModelName('regolo/apertus-70b', null, 'inference-coop')).toBe('Regolo Apertus 70b')
    expect(resolveModelName('some-custom-id')).toBe('some-custom-id')
  })
})
