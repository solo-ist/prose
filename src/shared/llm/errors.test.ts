// @vitest-environment node
import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { APICallError, RetryError } from 'ai'
import { classifyLlmError, isRetryableLlmError, llmErrorGuidance, llmErrorMessage } from './errors'
import { ChatCompletionsError } from '../../main/chatCompletions'
import { PROVIDERS } from './providers'
import { getNetworkErrorMessage, isRetryableError } from '../utils/retry'

/** What `chatCompletions.errorFromResponse` builds from an OpenAI-shaped error body. */
function openaiError(status: number, body: { message: string; type: string; code: string | null }): ChatCompletionsError {
  return new ChatCompletionsError(`HTTP ${status}: ${body.message}`, status, body.code ?? undefined, body.type)
}

// Real bodies (OpenAI's API error reference, and the operator's 2026-11-08 log for the first).
const NO_CREDITS = openaiError(429, {
  message: 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
  type: 'insufficient_quota',
  code: 'insufficient_quota',
})
const EXCEEDED_QUOTA = openaiError(429, {
  message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.',
  type: 'insufficient_quota',
  code: 'insufficient_quota',
})
const RATE_LIMITED = openaiError(429, {
  message: 'Rate limit reached for gpt-5 in organization org-abc on tokens per min (TPM): Limit 30000, Used 29500, Requested 1200. Please try again in 1.4s. Visit https://platform.openai.com/account/rate-limits to learn more.',
  type: 'tokens',
  code: 'rate_limit_exceeded',
})
const BAD_KEY = openaiError(401, {
  message: 'Incorrect API key provided: sk-proj-****abcd. You can find your API key at https://platform.openai.com/account/api-keys.',
  type: 'invalid_request_error',
  code: 'invalid_api_key',
})
// LiteLLM (Inference Coop, A3): a spent key budget, often a 400.
const LITELLM_BUDGET = new ChatCompletionsError('HTTP 400: Budget has been exceeded! Current cost: 15.02, Max budget: 15.0', 400, '400', 'budget_exceeded')

// The Anthropic SDK's own error classes, from its own factory.
const anthropicError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, {})
const ANTHROPIC_RATE = anthropicError(429, 'rate_limit_error', 'This request would exceed the rate limit for your organization of 50,000 input tokens per minute.')
const ANTHROPIC_CREDIT = anthropicError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
const ANTHROPIC_OVERLOADED = anthropicError(529, 'overloaded_error', 'Overloaded')

describe('classifyLlmError (#1268)', () => {
  it("OpenAI's insufficient_quota (HTTP 429) is quota, not a rate limit, and is never retried", () => {
    for (const e of [NO_CREDITS, EXCEEDED_QUOTA]) {
      const info = classifyLlmError(e)
      expect(info.kind).toBe('quota')
      expect(info.status).toBe(429)
      expect(isRetryableLlmError(info)).toBe(false)
      expect(isRetryableError(e)).toBe(false)
    }
  })

  it('quota reads as a plain, provider-named message with nothing about waiting', () => {
    const message = llmErrorMessage(classifyLlmError(NO_CREDITS), PROVIDERS.openai)
    expect(message).toBe("OpenAI says this key's account has no credits left. Add credits at platform.openai.com → Settings → Billing, then try again.")
    expect(llmErrorGuidance(classifyLlmError(NO_CREDITS), message)).toBe('')
    expect(message).not.toMatch(/wait/i)
  })

  it("OpenAI's rate_limit_exceeded stays a retried rate limit, with OpenAI's own wording", () => {
    const info = classifyLlmError(RATE_LIMITED)
    expect(info.kind).toBe('rate_limit')
    expect(isRetryableLlmError(info)).toBe(true)
    const message = llmErrorMessage(info, PROVIDERS.openai)
    expect(message).toContain('OpenAI rate limit: Rate limit reached for gpt-5')
    expect(message).toContain('Please try again in 1.4s')
    expect(llmErrorGuidance(info, message)).toBe('') // the provider already says when
  })

  it("LiteLLM's budget_exceeded (a 400) is quota", () => {
    expect(classifyLlmError(LITELLM_BUDGET).kind).toBe('quota')
  })

  it("Anthropic's 429 stays a rate limit; its 400 credit error is quota; 529 is transient", () => {
    expect(classifyLlmError(ANTHROPIC_RATE).kind).toBe('rate_limit')
    expect(classifyLlmError(ANTHROPIC_RATE).providerMessage).toContain('exceed the rate limit')
    const credit = classifyLlmError(ANTHROPIC_CREDIT)
    expect(credit.kind).toBe('quota')
    expect(llmErrorMessage(credit, PROVIDERS.anthropic)).toContain('Anthropic says')
    expect(isRetryableError(ANTHROPIC_CREDIT)).toBe(false)
    expect(classifyLlmError(ANTHROPIC_OVERLOADED).kind).toBe('transient')
    expect(isRetryableError(ANTHROPIC_OVERLOADED)).toBe(true)
  })

  it("the AI SDK's RetryError is read through to its last APICallError", () => {
    const call = new APICallError({
      message: 'Your credit balance is too low to access the Anthropic API.',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {},
      statusCode: 400,
      responseBody: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }),
    })
    const wrapped = new RetryError({ message: 'Failed after 3 attempts', reason: 'maxRetriesExceeded', errors: [call, call, call] })
    expect(classifyLlmError(wrapped).kind).toBe('quota')
  })

  it('auth, network, server and other', () => {
    const auth = classifyLlmError(BAD_KEY)
    expect(auth.kind).toBe('auth')
    expect(llmErrorMessage(auth, PROVIDERS.openai)).toBe('OpenAI did not accept this API key. Check it in Settings.')
    expect(llmErrorGuidance(auth)).toMatch(/API key in Settings/)
    const offline = Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    expect(classifyLlmError(offline).kind).toBe('transient')
    expect(isRetryableError(new Error('connect ECONNREFUSED 127.0.0.1:443'))).toBe(true)
    expect(classifyLlmError(new ChatCompletionsError('HTTP 503: upstream unavailable', 503)).kind).toBe('transient')
    const other = classifyLlmError(new ChatCompletionsError('HTTP 404: The model `gpt-9` does not exist', 404, 'model_not_found', 'invalid_request_error'))
    expect(other.kind).toBe('other')
    expect(llmErrorMessage(other)).toBe('The model `gpt-9` does not exist')
    expect(isRetryableLlmError(other)).toBe(false)
  })

  it('a bare message (an older main, the send-catch path) classifies the same way', () => {
    expect(classifyLlmError('HTTP 429: You have no credits remaining.').kind).toBe('quota')
    expect(classifyLlmError('OpenAI rate limit: Rate limit reached for gpt-5').kind).toBe('rate_limit')
  })

  it('getNetworkErrorMessage keeps its old wording for the transient cases', () => {
    expect(getNetworkErrorMessage(new Error('connect ECONNREFUSED'))).toMatch(/^Could not connect to the server/)
    expect(getNetworkErrorMessage(new Error('Request timed out'))).toMatch(/^Request timed out/)
  })
})
