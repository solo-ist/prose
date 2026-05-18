import type { ReactNode } from 'react'
import { ListFilesResult } from './ListFilesResult'

/**
 * Per-tool result renderer registry. Keyed by the tool name; each entry
 * returns a React node that replaces the default `renderMarkdown` output
 * (which dumps JSON inside a `<pre>` code block).
 *
 * Unknown tools return null from `renderToolResult` and the caller falls
 * back to the default markdown render.
 *
 * Adding a renderer: write the component under
 * `src/renderer/components/chat/toolResultRenderers/<Name>.tsx`, import
 * it here, add the entry to `toolResultRenderers`. Components receive
 * the raw `content` string and are responsible for parsing it (the
 * content is typically a JSON-stringified `ToolResult<T>` envelope,
 * sometimes wrapped in markdown code fences).
 */

type ToolResultRenderer = (content: string) => ReactNode

const toolResultRenderers: Record<string, ToolResultRenderer> = {
  list_files: (content) => <ListFilesResult content={content} />
}

export function renderToolResult(name: string, content: string): ReactNode | null {
  const renderer = toolResultRenderers[name]
  return renderer ? renderer(content) : null
}
