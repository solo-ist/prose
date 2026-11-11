/**
 * Both providers side by side (#1287): each keyed provider's live model list
 * is cached on its own, a pick sets the provider and the model together, and
 * losing the in-use provider's key moves Prose Agents to one that has a key.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSettingsStore } from './settingsStore'
import type { LLMKeyStatusMap } from '../../shared/llm/providers'

const LIVE = {
  anthropic: [{ id: 'claude-live', name: 'Claude Live' }],
  openai: [{ id: 'gpt-5.1', name: 'gpt-5.1' }]
}
const BOTH: LLMKeyStatusMap = { anthropic: { hint: 'ANTH', persisted: true }, openai: { hint: 'OPEN', persisted: true } }

const api = {
  fetchModels: vi.fn(async ({ provider }: { provider: 'anthropic' | 'openai' }) => ({ models: LIVE[provider] })),
  setLlmKey: vi.fn(),
  clearLlmKey: vi.fn()
}

function reset(keyStatus: LLMKeyStatusMap, llm: Partial<{ provider: 'anthropic' | 'openai'; model: string; modelByProvider: Record<string, string> }> = {}) {
  const base = useSettingsStore.getState().settings
  useSettingsStore.setState({
    settings: { ...base, llm: { provider: 'anthropic', model: 'claude-sonnet-5-5', ...llm, keyStatus } },
    liveModels: {},
    isFetchingModels: false
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: typeof api }).api = api
})

describe('live model lists per provider', () => {
  it('fetches every provider with a key and keeps each list under its provider', async () => {
    reset(BOTH)
    await useSettingsStore.getState().fetchModels()
    expect(api.fetchModels.mock.calls.map(([r]) => r.provider).sort()).toEqual(['anthropic', 'openai'])
    expect(useSettingsStore.getState().liveModels).toEqual(LIVE)
    expect(useSettingsStore.getState().isFetchingModels).toBe(false)
  })

  it('skips a provider without a key', async () => {
    reset({ openai: BOTH.openai })
    await useSettingsStore.getState().fetchModels()
    expect(api.fetchModels).toHaveBeenCalledTimes(1)
    expect(useSettingsStore.getState().liveModels).toEqual({ openai: LIVE.openai })
  })

  it('fetches one provider when asked', async () => {
    reset(BOTH)
    await useSettingsStore.getState().fetchModels('openai')
    expect(api.fetchModels).toHaveBeenCalledWith({ provider: 'openai' })
    expect(useSettingsStore.getState().liveModels).toEqual({ openai: LIVE.openai })
  })

  it("a new key brings its own provider's list, whichever provider is in use", async () => {
    reset({ anthropic: BOTH.anthropic })
    api.setLlmKey.mockImplementationOnce(async () => ({ ok: true, status: BOTH }))
    await useSettingsStore.getState().setLlmKey('openai', 'sk-proj-x')
    await vi.waitFor(() => expect(useSettingsStore.getState().liveModels.openai).toEqual(LIVE.openai))
    // Anthropic, in use with a key, stays in use.
    expect(useSettingsStore.getState().settings.llm.provider).toBe('anthropic')
  })
})

describe('selectModel', () => {
  it('sets the provider and the model together, remembering the model being left', () => {
    reset(BOTH, { provider: 'anthropic', model: 'claude-opus-5-5' })
    useSettingsStore.getState().selectModel('openai', 'gpt-5-mini')
    const { llm } = useSettingsStore.getState().settings
    expect(llm.provider).toBe('openai')
    expect(llm.model).toBe('gpt-5-mini')
    expect(llm.modelByProvider).toEqual({ anthropic: 'claude-opus-5-5' })
    // Back to Anthropic through the provider alone: its remembered model returns.
    useSettingsStore.getState().setActiveProvider('anthropic')
    expect(useSettingsStore.getState().settings.llm.model).toBe('claude-opus-5-5')
    expect(useSettingsStore.getState().settings.llm.modelByProvider).toEqual({ anthropic: 'claude-opus-5-5', openai: 'gpt-5-mini' })
  })

  it('a model from the same provider changes only the model', () => {
    reset(BOTH, { provider: 'openai', model: 'gpt-5', modelByProvider: { anthropic: 'claude-haiku-4-5' } })
    useSettingsStore.getState().selectModel('openai', 'gpt-5-mini')
    const { llm } = useSettingsStore.getState().settings
    expect(llm.model).toBe('gpt-5-mini')
    expect(llm.modelByProvider).toEqual({ anthropic: 'claude-haiku-4-5' })
  })

  it('keeps the live lists of both providers when switching', async () => {
    reset(BOTH)
    await useSettingsStore.getState().fetchModels()
    useSettingsStore.getState().selectModel('openai', 'gpt-5.1')
    expect(useSettingsStore.getState().liveModels).toEqual(LIVE)
  })
})

describe('clearing a key', () => {
  it('drops that provider\'s list, and moves off it to a provider that still has a key', async () => {
    reset(BOTH, { provider: 'openai', model: 'gpt-5.1', modelByProvider: { anthropic: 'claude-opus-5-5' } })
    await useSettingsStore.getState().fetchModels()
    api.clearLlmKey.mockImplementationOnce(async () => ({ anthropic: BOTH.anthropic }))
    await useSettingsStore.getState().clearLlmKey('openai')
    const state = useSettingsStore.getState()
    expect(state.liveModels).toEqual({ anthropic: LIVE.anthropic })
    expect(state.settings.llm.provider).toBe('anthropic')
    expect(state.settings.llm.model).toBe('claude-opus-5-5')
  })

  it('stays put when no provider has a key left', async () => {
    reset({ openai: BOTH.openai }, { provider: 'openai', model: 'gpt-5' })
    api.clearLlmKey.mockImplementationOnce(async () => ({}))
    await useSettingsStore.getState().clearLlmKey('openai')
    expect(useSettingsStore.getState().settings.llm.provider).toBe('openai')
  })

  it('clearing a provider not in use leaves the provider in use alone', async () => {
    reset(BOTH, { provider: 'anthropic', model: 'claude-sonnet-5-5' })
    api.clearLlmKey.mockImplementationOnce(async () => ({ anthropic: BOTH.anthropic }))
    await useSettingsStore.getState().clearLlmKey('openai')
    expect(useSettingsStore.getState().settings.llm.provider).toBe('anthropic')
    expect(useSettingsStore.getState().settings.llm.model).toBe('claude-sonnet-5-5')
  })
})

describe('the first key saved', () => {
  it('picks its provider while the provider in use has no key', async () => {
    reset({}, { provider: 'anthropic', model: 'claude-sonnet-5-5', modelByProvider: { openai: 'gpt-4.1' } })
    api.setLlmKey.mockImplementationOnce(async () => ({ ok: true, status: { openai: BOTH.openai } }))
    await useSettingsStore.getState().setLlmKey('openai', 'sk-proj-x')
    const { llm } = useSettingsStore.getState().settings
    expect(llm.provider).toBe('openai')
    // Its remembered model, else its default.
    expect(llm.model).toBe('gpt-4.1')
  })

  it("a second provider's key leaves the provider in use alone", async () => {
    reset({ openai: BOTH.openai }, { provider: 'openai', model: 'gpt-5' })
    api.setLlmKey.mockImplementationOnce(async () => ({ ok: true, status: BOTH }))
    await useSettingsStore.getState().setLlmKey('anthropic', 'sk-ant-x')
    expect(useSettingsStore.getState().settings.llm.provider).toBe('openai')
  })

  it('a key main refused changes nothing', async () => {
    reset({})
    api.setLlmKey.mockImplementationOnce(async () => ({ ok: false, error: 'nope', status: {} }))
    const result = await useSettingsStore.getState().setLlmKey('openai', 'sk-proj-x')
    expect(result).toEqual({ ok: false, error: 'nope' })
    expect(useSettingsStore.getState().settings.llm.provider).toBe('anthropic')
    expect(api.fetchModels).not.toHaveBeenCalled()
  })
})
