import { describe, expect, it } from 'vitest'
import { THINKING_BINDING_BETA, droppedThinking, withThinkingBinding } from './thinkingBinding'

describe('withThinkingBinding (#1289)', () => {
  it('asks adaptive thinking to drop mismatched blocks, under the beta header', () => {
    expect(withThinkingBinding({ type: 'adaptive', display: 'summarized' })).toEqual({
      thinking: { type: 'adaptive', display: 'summarized', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      headers: { 'anthropic-beta': THINKING_BINDING_BETA }
    })
  })

  it('leaves every other thinking setting alone: block_binding is a 400 there', () => {
    expect(withThinkingBinding({ type: 'between_tools' })).toEqual({ thinking: { type: 'between_tools' } })
    expect(withThinkingBinding({ type: 'disabled' })).toEqual({ thinking: { type: 'disabled' } })
    expect(withThinkingBinding(undefined)).toEqual({ thinking: undefined })
  })
})

describe('droppedThinking', () => {
  it('lists the thinking_dropped entries and ignores the rest', () => {
    const message = {
      input_transformations: [
        { type: 'thinking_dropped', reason: 'prefix_binding_mismatch', path: 'messages.3.content.0' },
        { type: 'thinking_mismatch_allowed', reason: 'prefix_binding_mismatch' },
        { type: 'something_new', reason: 'later' },
        null
      ]
    }
    expect(droppedThinking(message)).toEqual([{ reason: 'prefix_binding_mismatch', path: 'messages.3.content.0' }])
  })

  it('is empty without the field', () => {
    expect(droppedThinking({})).toEqual([])
    expect(droppedThinking(null)).toEqual([])
  })
})
