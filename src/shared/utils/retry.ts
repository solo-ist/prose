/**
 * Network retry utility with exponential backoff.
 * Used for handling transient network errors in LLM API calls.
 */

import { classifyLlmError, isRetryableLlmError, llmErrorMessage, type LlmErrorProvider } from '../llm/errors'

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Initial delay in ms (default: 1000) */
  initialDelay?: number
  /** Maximum delay in ms (default: 10000) */
  maxDelay?: number
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number
  /** Whether to add jitter to delays (default: true) */
  jitter?: boolean
  /** Callback for retry attempts */
  onRetry?: (attempt: number, error: Error, delay: number) => void
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: true
}

/**
 * Check if an error is retryable: a rate limit or transient trouble (network,
 * timeouts, 5xx, overloaded). Never quota (an account with no credits answers
 * 429 at OpenAI), auth or anything else. The one classification is
 * `classifyLlmError` (#1268).
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return isRetryableLlmError(classifyLlmError(error))
}

/**
 * Calculate delay for retry attempt with optional jitter.
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffMultiplier: number,
  jitter: boolean
): number {
  let delay = initialDelay * Math.pow(backoffMultiplier, attempt)
  delay = Math.min(delay, maxDelay)

  if (jitter) {
    // Add up to 25% random jitter to avoid thundering herd
    const jitterAmount = delay * 0.25 * Math.random()
    delay += jitterAmount
  }

  return Math.round(delay)
}

/**
 * Sleep for a given duration.
 * Uses globalThis.setTimeout for cross-environment compatibility (Node.js and browser).
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
}

/**
 * Execute a function with retry logic for transient errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options }
  let lastError: Error

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry if this isn't a retryable error
      if (!isRetryableError(error)) {
        throw lastError
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= config.maxRetries) {
        throw lastError
      }

      // Calculate delay and wait
      const delay = calculateDelay(
        attempt,
        config.initialDelay,
        config.maxDelay,
        config.backoffMultiplier,
        config.jitter
      )

      // Notify about retry
      if (config.onRetry) {
        config.onRetry(attempt + 1, lastError, delay)
      }

      await sleep(delay)
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError!
}

/**
 * Wrap an error with retry context for better error messages.
 */
export function enhanceErrorMessage(error: Error, retriesAttempted: number): Error {
  if (retriesAttempted > 0) {
    error.message = `${error.message} (after ${retriesAttempted} retry attempt${retriesAttempted > 1 ? 's' : ''})`
  }
  return error
}

/**
 * A user-facing message for an LLM or network error, naming the provider when
 * given. One classification, `classifyLlmError` (#1268): quota is told to add
 * credits, a rate limit passes the provider's wording through.
 */
export function getNetworkErrorMessage(error: unknown, provider?: LlmErrorProvider): string {
  if (!(error instanceof Error)) return 'Unknown error'
  return llmErrorMessage(classifyLlmError(error), provider)
}
