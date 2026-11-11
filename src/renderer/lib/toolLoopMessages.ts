import type { LLMContentBlock, LLMMessage, LLMThinkingBlock } from '../types'

/**
 * The assistant message that carries one response's tool calls, for the next
 * request of the tool loop: that response's own thinking blocks first,
 * unmodified, then its text, then its tool_use blocks.
 *
 * The thinking must come from the same response as the tool calls (#1289).
 * Anthropic binds each thinking block to the conversation that produced it
 * (the system prompt, the tool set and every earlier message), so a block
 * replayed one round late sits after messages it never saw and the request
 * fails with a 400 ("bound to a different conversation").
 */
export function toolRoundAssistantMessage(
  response: { thinkingBlocks?: LLMThinkingBlock[] },
  text: string,
  toolCalls: Array<{ id: string; name: string; args: unknown }>
): LLMMessage {
  const content: LLMContentBlock[] = [...(response.thinkingBlocks ?? [])]
  if (text.trim()) content.push({ type: 'text', text })
  for (const call of toolCalls) {
    content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args })
  }
  return { role: 'assistant', content }
}
