/**
 * Network retry utility with exponential backoff.
 * Plain JS port of src/shared/utils/retry.ts for CI scripts.
 */

const DEFAULT_OPTIONS = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: true,
  totalTimeout: 120000,
}

/**
 * Check if an error is retryable (transient network error).
 */
export function isRetryableError(error) {
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

  // Server errors (5xx)
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) return true
  if (message.includes('internal server error')) return true
  if (message.includes('bad gateway')) return true
  if (message.includes('service unavailable')) return true
  if (message.includes('gateway timeout')) return true

  // Anthropic overload (529)
  if (message.includes('529')) return true
  if (message.includes('overloaded')) return true

  return false
}

function calculateDelay(attempt, initialDelay, maxDelay, backoffMultiplier, jitter) {
  let delay = initialDelay * Math.pow(backoffMultiplier, attempt)
  delay = Math.min(delay, maxDelay)

  if (jitter) {
    const jitterAmount = delay * 0.25 * Math.random()
    delay += jitterAmount
  }

  return Math.round(delay)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Execute a function with retry logic for transient errors.
 *
 * @param {() => Promise<any>} fn - Function to execute
 * @param {object} options - Retry options
 * @param {number} options.maxRetries - Max retry attempts (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Max delay in ms (default: 10000)
 * @param {number} options.backoffMultiplier - Backoff multiplier (default: 2)
 * @param {boolean} options.jitter - Add jitter to delays (default: true)
 * @param {number} options.totalTimeout - Total timeout in ms (default: 120000)
 * @param {(attempt: number, error: Error, delay: number) => void} options.onRetry - Retry callback
 */
export async function withRetry(fn, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options }
  const deadline = Date.now() + config.totalTimeout
  let lastError

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (Date.now() >= deadline) {
      throw lastError || new Error(`Total timeout of ${config.totalTimeout}ms exceeded`)
    }

    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (!isRetryableError(error)) {
        throw lastError
      }

      if (attempt >= config.maxRetries) {
        throw lastError
      }

      const delay = calculateDelay(
        attempt,
        config.initialDelay,
        config.maxDelay,
        config.backoffMultiplier,
        config.jitter
      )

      // Don't sleep past the deadline
      const remainingTime = deadline - Date.now()
      if (delay >= remainingTime) {
        throw lastError
      }

      if (config.onRetry) {
        config.onRetry(attempt + 1, lastError, delay)
      }

      await sleep(delay)
    }
  }

  throw lastError
}
