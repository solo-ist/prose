/**
 * One classification of LLM API errors (#1268), shared by main (retries, the
 * messages it sends) and the renderer (the hint `useChat` appends), so neither
 * re-guesses from substrings.
 *
 * The case that forced it: OpenAI answers an account with no credits with
 * HTTP 429 `insufficient_quota`. A 429 used to mean "rate limited, wait and
 * retry" everywhere, so an empty account was retried and told to wait.
 */

export type LlmErrorKind =
  /** The account has no credits / budget left. Never retried; the writer must act. */
  | 'quota'
  /** A rate limit: retried, and the provider's wording (limits, reset time) passed through. */
  | 'rate_limit'
  /** The key was refused (401/403). */
  | 'auth'
  /** Network trouble, timeouts, 5xx, overloaded: retried. */
  | 'transient'
  | 'other'

export interface LlmErrorInfo {
  kind: LlmErrorKind
  status?: number
  code?: string
  type?: string
  /** The provider's own message, without our `HTTP nnn:` prefix, when one was found. */
  providerMessage: string
}

/** What a message needs to know about the provider that answered. */
export interface LlmErrorProvider {
  label: string
  /** Where the account's credits are managed, e.g. "platform.openai.com → Settings → Billing". */
  billingHint?: string
}

const QUOTA_CODES = new Set(['insufficient_quota', 'billing_hard_limit_reached', 'budget_exceeded', 'billing_not_active'])
const RATE_LIMIT_CODES = new Set(['rate_limit_exceeded', 'rate_limit_error', 'requests', 'tokens'])
const AUTH_CODES = new Set(['invalid_api_key', 'authentication_error', 'permission_error', 'invalid_request_error_auth'])
const QUOTA_TEXT = /insufficient[_ ]quota|no credits|credit balance is too low|exceeded your current quota|billing|budget (has been )?exceeded|budget_exceeded|out of credits/i

type Loose = Record<string, unknown>

function asObject(value: unknown): Loose | undefined {
  return value !== null && typeof value === 'object' ? (value as Loose) : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : undefined
}

/** `{ error: { message, type, code } }` (OpenAI, LiteLLM) or `{ type: 'error', error: { type, message } }` (Anthropic). */
function fromBody(body: unknown): { code?: string; type?: string; message?: string } {
  let parsed = body
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body)
    } catch {
      return {}
    }
  }
  const inner = asObject(asObject(parsed)?.error)
  if (!inner) return {}
  return { code: str(inner.code), type: str(inner.type), message: str(inner.message) }
}

function statusOf(e: Loose, message: string): number | undefined {
  for (const candidate of [e.status, e.statusCode]) {
    if (typeof candidate === 'number') return candidate
  }
  const http = /\bHTTP (\d{3})\b/.exec(message) ?? /^(\d{3})\b/.exec(message)
  return http ? Number(http[1]) : undefined
}

/** Classify any error an LLM call can throw: ours (`ChatCompletionsError`), the Anthropic SDK's, the AI SDK's, or a plain message. */
export function classifyLlmError(error: unknown): LlmErrorInfo {
  if (typeof error === 'string') return classifyLlmError(new Error(error))
  const e = asObject(error)
  if (!e) return { kind: 'other', providerMessage: 'Unknown error' }
  // The AI SDK's RetryError carries the real failure in lastError.
  const last = asObject(e.lastError)
  if (last && last !== e) return classifyLlmError(e.lastError)

  const rawMessage = str(e.message) ?? ''
  // The Anthropic SDK's parsed body (`e.error`) first, then the AI SDK's raw one.
  const sdkBody = fromBody(e.error)
  const rawBody = fromBody(e.responseBody)
  const body = {
    code: sdkBody.code ?? rawBody.code,
    type: sdkBody.type ?? rawBody.type,
    message: sdkBody.message ?? rawBody.message,
  }
  const code = (str(e.code) ?? body.code)?.toLowerCase()
  const type = (str(e.type) ?? body.type)?.toLowerCase()
  const status = statusOf(e, rawMessage)
  const providerMessage = body.message ?? rawMessage.replace(/^HTTP \d{3}:\s*/, '').replace(/^\d{3}\s+/, '')
  const text = `${rawMessage} ${body.message ?? ''}`.toLowerCase()
  const base = { status, code, type, providerMessage }

  if ((code && QUOTA_CODES.has(code)) || (type && QUOTA_CODES.has(type)) || QUOTA_TEXT.test(text)) {
    return { kind: 'quota', ...base }
  }
  if (status === 401 || status === 403 || (code && AUTH_CODES.has(code)) || (type && AUTH_CODES.has(type)) ||
      /invalid api key|incorrect api key|invalid x-api-key|unauthorized|forbidden/.test(text)) {
    return { kind: 'auth', ...base }
  }
  if (status === 429 || (code && RATE_LIMIT_CODES.has(code)) || (type && RATE_LIMIT_CODES.has(type)) ||
      /rate[_ ]limit/.test(text)) {
    return { kind: 'rate_limit', ...base }
  }
  if ((status !== undefined && (status >= 500 || status === 408)) || type === 'overloaded_error' ||
      /econnrefused|econnreset|etimedout|enotfound|network|fetch failed|timeout|timed out|overloaded|internal server error|bad gateway|service unavailable|gateway timeout/.test(text)) {
    return { kind: 'transient', ...base }
  }
  return { kind: 'other', ...base }
}

/** Retry rate limits and transient trouble; never quota, auth or anything else. */
export function isRetryableLlmError(info: LlmErrorInfo): boolean {
  return info.kind === 'rate_limit' || info.kind === 'transient'
}

/** The sentence the writer sees: plain, naming the provider when known. */
export function llmErrorMessage(info: LlmErrorInfo, provider?: LlmErrorProvider): string {
  const who = provider?.label ?? 'The provider'
  switch (info.kind) {
    case 'quota':
      return provider?.billingHint
        ? `${who} says this key's account has no credits left. Add credits at ${provider.billingHint}, then try again.`
        : `${who} says this key's account has no credits left. Add credits in its billing settings, then try again.`
    case 'rate_limit':
      return info.providerMessage
        ? `${who} rate limit: ${info.providerMessage}`
        : 'Rate limited by the API. Please wait a moment and try again.'
    case 'auth':
      return info.status === 403
        ? `${who} refused this request. Your API key may not have the required permissions.`
        : `${who} did not accept this API key. Check it in Settings.`
    case 'transient': {
      const text = info.providerMessage.toLowerCase()
      if (text.includes('econnrefused')) return 'Could not connect to the server. Please check that the service is running.'
      if (text.includes('enotfound')) return 'Could not resolve server address. Please check your internet connection.'
      if (text.includes('timeout') || text.includes('timed out') || text.includes('etimedout')) return 'Request timed out. The server may be overloaded or unreachable.'
      if (text.includes('overloaded') || info.status === 529) return 'The API is currently overloaded. Please try again in a few moments.'
      if (info.status !== undefined && info.status >= 500) return 'The server encountered an error. Please try again later.'
      return info.providerMessage || 'A network error occurred. Please try again.'
    }
    case 'other':
      return info.providerMessage || 'Unknown error'
  }
}

/** The short hint the chat appends after the message ('' when the message already says what to do). */
export function llmErrorGuidance(info: Pick<LlmErrorInfo, 'kind'>, message = ''): string {
  switch (info.kind) {
    case 'quota':
      return ''
    case 'rate_limit':
      return /try again/i.test(message) ? '' : 'Wait a moment and try again.'
    case 'auth':
      return 'Check your API key in Settings (⌘,).'
    case 'transient':
      return /network|connect|resolve/i.test(message) ? 'Check your internet connection.' : ''
    case 'other':
      return ''
  }
}
