/**
 * AI pipeline debug log — stage-by-stage visibility into the AI edit pipeline
 * (#672): tool calls, suggestion accept decisions, annotation lifecycle
 * (create/map/detach/load/save), tab switches, documentId changes.
 *
 * Gated on `featureFlags.aiPipelineDebug` (settings.json, no rebuild needed):
 *
 *   "featureFlags": { "aiPipelineDebug": true }
 *
 * When enabled, every event is mirrored to the console as
 * `[AIPipeline] <event> <data>` and retained in an in-memory circular buffer
 * (last 500 entries). The buffer is exposed for bug reports via the always-on
 * window seam (see main.tsx):
 *
 *   window.__prose_debug.exportLog()  // JSON string of the buffer
 *   window.__prose_debug.copyLog()    // same, straight to the clipboard
 *
 * When the flag is off, pipelineLog() is a no-op — zero production noise.
 */
import { useSettingsStore } from '../stores/settingsStore'

export interface PipelineLogEntry {
  /** Epoch ms */
  ts: number
  /** Stage-qualified event name, e.g. 'suggest_edit:start', 'annotation:detach' */
  event: string
  data: Record<string, unknown>
}

const MAX_ENTRIES = 500
const buffer: PipelineLogEntry[] = []

export function isPipelineDebugEnabled(): boolean {
  return useSettingsStore.getState().settings.featureFlags?.aiPipelineDebug === true
}

/**
 * Record a pipeline event. Cheap no-op unless the debug flag is on, so call
 * sites don't need their own gating. Keep `data` JSON-serializable and small —
 * truncate document content to short prefixes at the call site.
 */
export function pipelineLog(event: string, data: Record<string, unknown> = {}): void {
  if (!isPipelineDebugEnabled()) return
  buffer.push({ ts: Date.now(), event, data })
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  console.log('[AIPipeline]', event, data)
}

/** JSON dump of the buffer — the paste-into-bug-report payload. */
export function dumpPipelineLog(): string {
  return JSON.stringify(buffer, null, 2)
}

export function clearPipelineLog(): void {
  buffer.length = 0
}
