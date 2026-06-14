import { useState, useEffect } from 'react'
import { generateEmoji, getEmojiSync, FALLBACK_EMOJI } from '../lib/emojiService'
import type { Tab } from '../stores/tabStore'

/**
 * Returns an emoji for a tab. Always generates eagerly so the emoji is
 * ready when the tab bar needs to display it. Starts with cached emoji
 * or fallback, updates async when generation completes.
 */
export function useTabEmoji(tab: Tab): string {
  const [emoji, setEmoji] = useState<string>(() => {
    return getEmojiSync(tab) ?? FALLBACK_EMOJI
  })

  useEffect(() => {
    // Check sync cache — only skip generation if we have a real (non-fallback) emoji
    const cached = getEmojiSync(tab)
    if (cached) {
      setEmoji(cached)
      return
    }

    // No cached emoji — trigger generation
    let cancelled = false
    generateEmoji(tab).then((result) => {
      if (!cancelled) setEmoji(result)
    })

    return () => { cancelled = true }
    // Keyed on tab.id (not just path/title): a new/Untitled tab can share a
    // path (null) with a previous one, so without tab.id the effect wouldn't
    // re-run and an earlier tab's in-flight emoji could resolve onto this tab
    // (e.g. a "…Robots" emoji leaking onto the next Untitled tab).
  }, [tab.id, tab.path, tab.title])

  return emoji
}
