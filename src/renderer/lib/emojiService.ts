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
const inflight = new Map<string, Promise<string | null>>()

// Concurrency limiter
const MAX_CONCURRENT = 2
let activeCount = 0
const queue: Array<() => void> = []

export const FALLBACK_EMOJI = '\u{1F4C4}' // 📄

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

function getContentPreview(tab: { content?: string }): string | undefined {
  if (!tab.content) return undefined
  // First 200 chars of content, stripped of markdown syntax noise
  return tab.content.slice(0, 200).replace(/^#+\s*/gm, '').trim() || undefined
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

/**
 * Generate an emoji for a tab. Returns cached result immediately if available,
 * otherwise triggers async generation and returns fallback.
 * Only caches real emoji results — fallbacks are NOT cached, allowing retries.
 */
export async function generateEmoji(tab: { path: string | null; title: string; content?: string }): Promise<string> {
  const key = getCacheKey(tab)

  // 1. Check memory cache (only contains real emojis, never fallback)
  const cached = memoryCache.get(key)
  if (cached) return cached

  // 2. Check for inflight request (dedup)
  const existing = inflight.get(key)
  if (existing) {
    const result = await existing
    return result ?? FALLBACK_EMOJI
  }

  // 3. Check IndexedDB cache (skip stale fallback entries from prior buggy runs)
  try {
    const dbEntry = await loadEmojiCache(key)
    if (dbEntry && dbEntry.emoji !== FALLBACK_EMOJI) {
      memoryCache.set(key, dbEntry.emoji)
      return dbEntry.emoji
    }
  } catch {
    // Ignore DB errors, proceed to API
  }

  // 4. Make API call via IPC (main process handles provider/key checks)
  const title = getPromptTitle(tab)
  const contentPreview = getContentPreview(tab)
  const promise = (async (): Promise<string | null> => {
    await acquireConcurrencySlot()
    try {
      const result = await getApi().emojiGenerate(title, contentPreview)

      if (result.emoji) {
        memoryCache.set(key, result.emoji)
        // Persist to IndexedDB
        await saveEmojiCache(key, {
          emoji: result.emoji,
          generatedAt: Date.now(),
          titleAtGeneration: title
        }).catch(() => {}) // Don't fail on DB error
        return result.emoji
      }

      // No emoji returned (no API key, error, etc.) — don't cache
      console.warn('[emojiService] No emoji generated:', result.error)
      return null
    } catch (err) {
      console.warn('[emojiService] Generation failed:', err)
      return null
    } finally {
      releaseConcurrencySlot()
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  const result = await promise
  return result ?? FALLBACK_EMOJI
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
export async function regenerateEmoji(tab: { path: string | null; title: string; content?: string }): Promise<string> {
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
      // Skip stale fallback entries from prior runs that cached 📄
      if (entry.emoji === FALLBACK_EMOJI) continue
      memoryCache.set(key, entry.emoji)
    }
  } catch {
    // Ignore errors during seeding
  }
}
