import { beforeEach, describe, expect, it, vi } from 'vitest'

const emojiGenerate = vi.fn()
const state = {
  settings: {
    aiConsent: { consented: true },
    llm: { provider: 'openai', model: 'gpt-6-astra', keyStatus: { openai: { hint: 'OAIK', persisted: true } } }
  }
}

vi.mock('./browserApi', () => ({ getApi: () => ({ emojiGenerate }) }))
vi.mock('./persistence', () => ({
  saveEmojiCache: vi.fn(async () => {}),
  loadEmojiCache: vi.fn(async () => null),
  loadAllEmojiCache: vi.fn(async () => ({})),
  deleteEmojiCache: vi.fn(async () => {})
}))
vi.mock('../stores/settingsStore', () => ({ useSettingsStore: { getState: () => state } }))

import { FALLBACK_EMOJI, generateEmoji } from './emojiService'

let n = 0
const tab = () => ({ id: `tab-${++n}`, path: null, title: 'River notes', content: '# Rivers\nThe Loire.' })

describe('generateEmoji', () => {
  beforeEach(() => {
    emojiGenerate.mockReset()
    emojiGenerate.mockResolvedValue({ emoji: '🌊' })
    state.settings.aiConsent.consented = true
    state.settings.llm = { provider: 'openai', model: 'gpt-6-astra', keyStatus: { openai: { hint: 'OAIK', persisted: true } } }
  })

  it('asks the provider in use, leaving the model to main (#1324)', async () => {
    expect(await generateEmoji(tab())).toBe('🌊')
    expect(emojiGenerate).toHaveBeenCalledWith('River notes', 'Rivers\nThe Loire.', 'openai')
  })

  it('follows the selection to another provider', async () => {
    state.settings.llm = {
      provider: 'inference-coop',
      model: 'tinfoil/glm-5.3',
      keyStatus: { 'inference-coop': { hint: 'COOP', persisted: true } }
    } as never
    await generateEmoji(tab())
    expect(emojiGenerate).toHaveBeenCalledWith('River notes', expect.any(String), 'inference-coop')
  })

  it('makes no call without consent or without a key for the provider in use', async () => {
    state.settings.aiConsent.consented = false
    expect(await generateEmoji(tab())).toBe(FALLBACK_EMOJI)
    state.settings.aiConsent.consented = true
    state.settings.llm = { ...state.settings.llm, keyStatus: {} as never }
    expect(await generateEmoji(tab())).toBe(FALLBACK_EMOJI)
    expect(emojiGenerate).not.toHaveBeenCalled()
  })
})
