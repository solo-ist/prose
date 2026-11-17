import type { ToolMode } from '../../shared/tools/types'

/**
 * Tells the settings store about a mode change the moment it happens (#1322),
 * so the mode's default model is in place before a message sent right after
 * the switch reads the model ("Switch & Run"). It exists because chatStore and
 * settingsStore must not import each other statically; both import this.
 */
let listener: ((mode: ToolMode) => void) | null = null
let mode: ToolMode | null = null

export function onToolModeChange(fn: (mode: ToolMode) => void): void {
  listener = fn
}

export function notifyToolModeChange(next: ToolMode): void {
  mode = next
  listener?.(next)
}

/** The mode last announced, or null before chatStore has announced one. */
export function lastToolMode(): ToolMode | null {
  return mode
}
