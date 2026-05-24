import type { ReactNode } from 'react'
import { ListFilesResult } from './ListFilesResult'
import { RequestModeSwitchBody, RequestModeSwitchActions } from './RequestModeSwitchResult'

/**
 * Per-tool result renderer registry. Keyed by tool name; each entry
 * returns `{ body?, actions? }`:
 *   - `body` replaces the default `renderMarkdown` output (which dumps
 *     JSON inside a `<pre>` code block) and lives inside the
 *     collapsible/scrollable region of the tool-call shell.
 *   - `actions` (optional) lives outside the collapsible region and
 *     stays visible regardless of expansion state. Use for affordances
 *     the user shouldn't have to expand to find (e.g., one-click
 *     mode-switch buttons).
 *
 * `ctx` exposes `messageId` + `toolPartIdx` so actions can persist
 * their interaction state into the owning message's `toolActions` map
 * (saved with the conversation).
 *
 * Unknown tools return `null` and the caller falls back to the default
 * markdown render in the body slot.
 *
 * Adding a renderer: write the component(s) under
 * `src/renderer/components/chat/toolResultRenderers/<Name>.tsx`, import
 * here, add the entry. The body component is responsible for parsing
 * the raw `content` string (typically a JSON-stringified
 * `ToolResult<T>` envelope, sometimes wrapped in markdown code fences).
 */

export interface ToolResultSlots {
  body?: ReactNode
  actions?: ReactNode
  /**
   * Initial expand state for the collapsible body. Defaults to false
   * (collapsed) so noisy JSON dumps stay out of the way. Set to true
   * for tools where the body content is the point of the response and
   * the user shouldn't have to hunt for it (e.g., `request_mode_switch`
   * — the reason and prompt-to-retry quote are the substance).
   */
  defaultExpanded?: boolean
}

export interface ToolResultContext {
  messageId: string
  toolPartIdx: number
}

type ToolResultRenderer = (content: string, ctx: ToolResultContext) => ToolResultSlots

const toolResultRenderers: Record<string, ToolResultRenderer> = {
  list_files: (content) => ({ body: <ListFilesResult content={content} /> }),
  request_mode_switch: (content, ctx) => ({
    body: <RequestModeSwitchBody content={content} />,
    actions: <RequestModeSwitchActions content={content} messageId={ctx.messageId} toolPartIdx={ctx.toolPartIdx} />,
    defaultExpanded: true
  })
}

export function renderToolResult(name: string, content: string, ctx: ToolResultContext): ToolResultSlots | null {
  const renderer = toolResultRenderers[name]
  return renderer ? renderer(content, ctx) : null
}
