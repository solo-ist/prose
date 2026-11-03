/**
 * Read the active document's state from React (#1146).
 *
 * `selector` runs over the active session's `EditorState` (null when no
 * document is open) and re-runs when a transaction lands or the active tab
 * changes. The value is cached per state, and a new value equal to the old
 * one (`isEqual`, `Object.is` by default) keeps the old reference, so a
 * component re-renders only when what it selected changed. Pass a selector
 * defined once (module scope or `useCallback`): the cache keys on the state,
 * not on the selector.
 */

import { useRef, useSyncExternalStore } from 'react'
import type { EditorState } from '@tiptap/pm/state'
import { activeSessionState, getActiveSession, subscribeActiveSession, type SourceSession } from './session'

/**
 * The active tab's source session (#1150): the object is stable while the
 * tab is in source mode (typing changes its `state` field, not the object),
 * so the surface re-renders on enter and exit only.
 */
export function useActiveSource(): SourceSession | null {
  const read = () => getActiveSession()?.source ?? null
  return useSyncExternalStore(subscribeActiveSession, read, () => null)
}

export function useActiveSession<T>(
  selector: (state: EditorState | null) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  const cache = useRef<{ state: EditorState | null; value: T } | null>(null)
  const getSnapshot = () => {
    const state = activeSessionState()
    const cached = cache.current
    if (cached && cached.state === state) return cached.value
    const value = selector(state)
    if (cached && isEqual(cached.value, value)) {
      cache.current = { state, value: cached.value }
      return cached.value
    }
    cache.current = { state, value }
    return value
  }
  return useSyncExternalStore(subscribeActiveSession, getSnapshot, getSnapshot)
}
