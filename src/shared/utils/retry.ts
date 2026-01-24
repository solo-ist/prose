/**
 * Network retry utility with exponential backoff.
 * Used for handling transient network errors in LLM API calls.
 */

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
 * Check if an error is retryable (transient network error).
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()

  // Network connectivity errors
  if (message.includes('econnrefused')) return true
  if (message.includes('econnreset')) return true
  if (message.includes('etimedout')) return true
  if (message.includes('enotfound')) return true
  if (message.includes('network')) return true
  if (message.includes('fetch failed')) return true

  // Rate limiting (429)
  if (message.includes('429') || message.includes('rate_limit') || message.includes('rate limit')) return true

  // Server errors (5xx) - these might be transient
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) return true
  if (message.includes('internal server error')) return true
  if (message.includes('bad gateway')) return true
  if (message.includes('service unavailable')) return true
  if (message.includes('gateway timeout')) return true

  // Overloaded
  if (message.includes('overloaded')) return true

  return false
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
 * Get a user-friendly error message for network errors.
 */
export function getNetworkErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error'

  const message = error.message.toLowerCase()

  if (message.includes('econnrefused')) {
    return 'Could not connect to the server. Please check that the service is running.'
  }
  if (message.includes('etimedout') || message.includes('timeout')) {
    return 'Request timed out. The server may be overloaded or unreachable.'
  }
  if (message.includes('enotfound')) {
    return 'Could not resolve server address. Please check your internet connection.'
  }
  if (message.includes('429') || message.includes('rate_limit')) {
    return 'Rate limited by the API. Please wait a moment and try again.'
  }
  if (message.includes('401') || message.includes('unauthorized')) {
    return 'Invalid API key. Please check your settings.'
  }
  if (message.includes('403') || message.includes('forbidden')) {
    return 'Access denied. Your API key may not have the required permissions.'
  }
  if (message.includes('500') || message.includes('internal server error')) {
    return 'The server encountered an error. Please try again later.'
  }
  if (message.includes('502') || message.includes('bad gateway')) {
    return 'Server temporarily unavailable. Please try again later.'
  }
  if (message.includes('503') || message.includes('service unavailable')) {
    return 'Service temporarily unavailable. Please try again later.'
  }
  if (message.includes('overloaded')) {
    return 'The API is currently overloaded. Please try again in a few moments.'
  }

  return error.message
}
