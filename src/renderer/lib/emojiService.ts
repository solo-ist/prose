import { getApi } from './browserApi'
import {
  saveEmojiCache,
  loadEmojiCache,
  loadAllEmojiCache,
  deleteEmojiCache
} from './persistence'

// In-memory cache for synchronous lookups
const memoryCache = new Map<string, string>()

// In-flight request dedup
const inflight = new Map<string, Promise<string>>()

// Concurrency limiter
const MAX_CONCURRENT = 2
let activeCount = 0
const queue: Array<() => void> = []

const FALLBACK_EMOJI = '\u{1F4C4}' // 📄
const EMOJI_REGEX = /^\p{Emoji_Presentation}$/u

function getCacheKey(tab: { path: string | null; title: string }): string {
  return tab.path ? `path:${tab.path}` : `title:${tab.title}`
}

function getPromptTitle(tab: { path: string | null; title: string }): string {
  if (tab.path) {
    // Extract filename without extension
    const filename = tab.path.split('/').pop() || tab.title
    return filename.replace(/\.[^.]+$/, '')
  }
  return tab.title
}

async function acquireConcurrencySlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++
    return
  }
  return new Promise((resolve) => {
    queue.push(() => {
      activeCount++
      resolve()
    })
  })
}

function releaseConcurrencySlot(): void {
  activeCount--
  const next = queue.shift()
  if (next) next()
}

async function callAnthropicApi(title: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: 'Respond with exactly ONE emoji that represents the document title. Nothing else — no text, no explanation, just the emoji.',
      messages: [{ role: 'user', content: title }]
    })
  })

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`)
  }

  const data = await response.json()
  const text = data.content?.[0]?.text?.trim() ?? ''

  // Validate: must be a single emoji
  // Be permissive — accept the first emoji-like character(s)
  const emojiMatch = text.match(/\p{Emoji_Presentation}/u)
  if (emojiMatch) {
    return emojiMatch[0]
  }

  return FALLBACK_EMOJI
}

/**
 * Generate an emoji for a tab. Returns cached result immediately if available,
 * otherwise triggers async generation and returns fallback.
 */
export async function generateEmoji(tab: { path: string | null; title: string }): Promise<string> {
  const key = getCacheKey(tab)

  // 1. Check memory cache
  const cached = memoryCache.get(key)
  if (cached) return cached

  // 2. Check for inflight request (dedup)
  const existing = inflight.get(key)
  if (existing) return existing

  // 3. Check IndexedDB cache
  try {
    const dbEntry = await loadEmojiCache(key)
    if (dbEntry) {
      memoryCache.set(key, dbEntry.emoji)
      return dbEntry.emoji
    }
  } catch {
    // Ignore DB errors, proceed to API
  }

  // 4. Check if we have an Anthropic API key
  const settings = await getApi().loadSettings()
  if (settings.llm.provider !== 'anthropic' || !settings.llm.apiKey) {
    memoryCache.set(key, FALLBACK_EMOJI)
    return FALLBACK_EMOJI
  }

  // 5. Make API call with concurrency limiting
  const title = getPromptTitle(tab)
  const promise = (async () => {
    await acquireConcurrencySlot()
    try {
      const emoji = await callAnthropicApi(title, settings.llm.apiKey)
      memoryCache.set(key, emoji)
      // Persist to IndexedDB
      await saveEmojiCache(key, {
        emoji,
        generatedAt: Date.now(),
        titleAtGeneration: title
      }).catch(() => {}) // Don't fail on DB error
      return emoji
    } catch (err) {
      console.warn('[emojiService] Generation failed:', err)
      memoryCache.set(key, FALLBACK_EMOJI)
      return FALLBACK_EMOJI
    } finally {
      releaseConcurrencySlot()
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  return promise
}

/**
 * Get emoji synchronously from memory cache. Returns undefined if not cached.
 */
export function getEmojiSync(tab: { path: string | null; title: string }): string | undefined {
  return memoryCache.get(getCacheKey(tab))
}

/**
 * Regenerate emoji for a tab (clears cache and generates fresh).
 */
export async function regenerateEmoji(tab: { path: string | null; title: string }): Promise<string> {
  const key = getCacheKey(tab)
  memoryCache.delete(key)
  await deleteEmojiCache(key).catch(() => {})
  return generateEmoji(tab)
}

/**
 * Seed the memory cache from IndexedDB on app init.
 */
export async function seedEmojiCache(): Promise<void> {
  try {
    const entries = await loadAllEmojiCache()
    for (const [key, entry] of Object.entries(entries)) {
      memoryCache.set(key, entry.emoji)
    }
  } catch {
    // Ignore errors during seeding
  }
}
