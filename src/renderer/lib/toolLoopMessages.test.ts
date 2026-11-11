import { describe, expect, it } from 'vitest'
import { toolRoundAssistantMessage } from './toolLoopMessages'
import type { LLMContentBlock, LLMMessage, LLMThinkingBlock } from '../types'

const call = (id: string) => ({ id, name: 'read_document', args: { n: id } })

describe('toolRoundAssistantMessage (#1289)', () => {
  it("puts the response's own thinking first, unmodified, then text, then tool_use", () => {
    const thinking: LLMThinkingBlock = { type: 'thinking', thinking: 'plan', signature: 'sig-1' }
    const msg = toolRoundAssistantMessage({ thinkingBlocks: [thinking] }, 'Reading.', [call('a'), call('b')])
    expect(msg).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'plan', signature: 'sig-1' },
        { type: 'text', text: 'Reading.' },
        { type: 'tool_use', id: 'a', name: 'read_document', input: { n: 'a' } },
        { type: 'tool_use', id: 'b', name: 'read_document', input: { n: 'b' } }
      ]
    })
  })

  it('omits an empty text block and copes with no thinking', () => {
    const msg = toolRoundAssistantMessage({}, '  \n', [call('a')])
    expect(msg.content).toEqual([{ type: 'tool_use', id: 'a', name: 'read_document', input: { n: 'a' } }])
  })

  // The API's check, in miniature: a thinking block's signature records the
  // messages that came before the response that produced it, and a request
  // that replays the block anywhere else is rejected.
  it('keeps every thinking block next to the messages it was produced after, across three rounds', () => {
    const prefixOf = (messages: LLMMessage[]) => JSON.stringify(messages)
    const messages: LLMMessage[] = [{ role: 'user', content: 'Make a suggestion on this selection.' }]

    for (const [round, tool] of ['read_selection', 'read_document', 'suggest_edit'].entries()) {
      // The response to the request made of `messages` so far.
      const response = {
        thinkingBlocks: [{ type: 'thinking' as const, thinking: `round ${round}`, signature: prefixOf(messages) }]
      }
      messages.push(toolRoundAssistantMessage(response, '', [{ id: `t${round}`, name: tool, args: {} }]))
      messages.push({ role: 'tool', content: 'ok', tool_call_id: `t${round}` })

      // What the next request carries must pass the check.
      messages.forEach((m, i) => {
        if (m.role !== 'assistant' || typeof m.content === 'string') return
        for (const block of m.content as LLMContentBlock[]) {
          if (block.type === 'thinking') expect(block.signature).toBe(prefixOf(messages.slice(0, i)))
        }
      })
    }
  })
})
