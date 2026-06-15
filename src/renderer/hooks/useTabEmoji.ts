import { useState, useEffect, useCallback } from 'react'
import { generateEmoji, regenerateEmoji, getEmojiSync, FALLBACK_EMOJI } from '../lib/emojiService'
import type { Tab } from '../stores/tabStore'

export interface TabEmoji {
  /** The emoji to display for this tab. */
  emoji: string
  /**
   * Clear this tab's cached emoji and generate a fresh one, updating the
   * displayed value when it resolves. Optionally pass live content (e.g. the
   * active tab's in-editor text) since `tab.content` can lag behind the editor.
   */
  regenerate: (contentOverride?: string) => Promise<void>
}

/**
 * Returns an emoji for a tab plus a regenerate function. Always generates
 * eagerly so the emoji is ready when the tab bar needs to display it. Starts
 * with cached emoji or fallback, updates async when generation completes.
 */
export function useTabEmoji(tab: Tab): TabEmoji {
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

  // Regenerate is a user action (the tab's "Regenerate Emoji" menu item). The
  // service clears its cache and re-generates; we must push the result into
  // local state ourselves — the effect above won't re-run (its deps are
  // unchanged), so without this the visible emoji would never update.
  const regenerate = useCallback(async (contentOverride?: string) => {
    const result = await regenerateEmoji(
      contentOverride !== undefined ? { ...tab, content: contentOverride } : tab
    )
    setEmoji(result)
  }, [tab])

  return { emoji, regenerate }
}
