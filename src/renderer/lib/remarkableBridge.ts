/**
 * Single eager-init subscriber for reMarkable sync progress IPC events.
 *
 * Without this, every component that calls useRemarkableSync registers its own
 * window.api.onRemarkableSyncProgress listener — when both FileListPanel and
 * RemarkableIntegration are mounted, every progress event fires twice and
 * loadNotebooks runs twice on each notebook-done. Lifting the IPC subscription
 * to module scope means exactly one preload listener regardless of how many
 * hook callers are mounted.
 *
 * Hot-module-reload safe: import.meta.hot.dispose tears down both the IPC
 * listener and the local emitter so dev hot-reloads don't stack subscriptions.
 */

import type { RemarkableSyncPhase } from '../types'

export interface SyncProgressUpdate {
  message: string
  notebookId?: string
  notebookName?: string
  current?: number
  total?: number
  phase: RemarkableSyncPhase
}

type Listener = (update: SyncProgressUpdate) => void

const listeners = new Set<Listener>()

export function subscribeRemarkableProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

let unsubscribeIpc: (() => void) | null = null

function attach(): void {
  if (unsubscribeIpc || !window.api?.onRemarkableSyncProgress) return
  unsubscribeIpc = window.api.onRemarkableSyncProgress((update) => {
    for (const listener of listeners) listener(update)
  })
}

attach()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeIpc?.()
    unsubscribeIpc = null
    listeners.clear()
  })
}
