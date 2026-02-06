import { useState, useEffect, useRef } from 'react'
import { generateEmoji, getEmojiSync } from '../lib/emojiService'
import type { Tab } from '../stores/tabStore'

const FALLBACK_EMOJI = '\u{1F4C4}' // 📄

/**
 * Returns an emoji for a tab. Only triggers generation when needsEmoji is true (tier >= 3).
 * Starts with cached emoji or fallback, updates async when generation completes.
 */
export function useTabEmoji(tab: Tab, needsEmoji: boolean): string {
  const [emoji, setEmoji] = useState<string>(() => {
    return getEmojiSync(tab) ?? FALLBACK_EMOJI
  })
  const prevKeyRef = useRef<string>('')

  useEffect(() => {
    if (!needsEmoji) return

    const key = tab.path ? `path:${tab.path}` : `title:${tab.title}`

    // Check sync cache first
    const cached = getEmojiSync(tab)
    if (cached) {
      setEmoji(cached)
      prevKeyRef.current = key
      return
    }

    // Only generate if key changed (avoid re-generating on every render)
    if (key === prevKeyRef.current) return
    prevKeyRef.current = key

    let cancelled = false
    generateEmoji(tab).then((result) => {
      if (!cancelled) setEmoji(result)
    })

    return () => { cancelled = true }
  }, [needsEmoji, tab.path, tab.title])

  return needsEmoji ? emoji : FALLBACK_EMOJI
}
