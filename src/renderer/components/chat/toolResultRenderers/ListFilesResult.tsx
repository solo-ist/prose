import { useState } from 'react'
import { FileTree } from '../../files/FileTree'
import { useTabs } from '../../../hooks/useTabs'
import { useFileListStore } from '../../../stores/fileListStore'
import type { FileItem } from '../../../types'

interface ListFilesResultProps {
  content: string
}

interface ListFilesPayload {
  files: FileItem[]
  truncated?: boolean
  totalFound?: number
}

interface ListFilesEnvelope extends Partial<ListFilesPayload> {
  data?: ListFilesPayload
}

/**
 * The tool-result string may arrive either as the raw payload
 * `{ files: [...] }` or wrapped in a `{ data: { files } }` envelope,
 * depending on whether the renderer is invoked from a live tool call
 * (envelope) or a parsed-from-markdown rehydration (raw). Accept both.
 *
 * Error envelopes never reach here — ChatMessage only invokes the
 * renderer when `part.success === true`. Failures fall back to the
 * markdown render path.
 */
function extractPayload(env: ListFilesEnvelope): ListFilesPayload {
  if (env.data?.files) return env.data
  if (env.files) return { files: env.files, truncated: env.truncated, totalFound: env.totalFound }
  return { files: [] }
}

/**
 * Custom renderer for the `list_files` tool result.
 * Replaces the default JSON-in-a-pre-block render with the same FileTree
 * component the file explorer side panel uses — single-click opens the
 * file in a preview tab, folders toggle expand/collapse via local state.
 *
 * The tool result content arrives as a JSON string (possibly wrapped in
 * markdown code fences). We parse defensively and fall back to a textual
 * apology + raw content dump if the shape changes unexpectedly.
 */
export function ListFilesResult({ content }: ListFilesResultProps) {
  // Seed the chat-side tree with the same folders the file explorer panel
  // currently has open, so the user sees a matching shape on first render.
  // After this snapshot the chat tree's expansion is independent — clicking
  // folders here doesn't propagate back to the side panel.
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(useFileListStore.getState().expandedFolders)
  )
  const { openFileInPreviewTab } = useTabs()

  let parsed: ListFilesEnvelope | null = null
  try {
    const cleaned = content.replace(/```json\n?|\n?```/g, '').trim()
    parsed = JSON.parse(cleaned) as ListFilesEnvelope
  } catch {
    return (
      <div className="text-xs text-muted-foreground">
        <div className="mb-1">Unable to parse file list result.</div>
        <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap">{content}</pre>
      </div>
    )
  }

  const payload = parsed ? extractPayload(parsed) : { files: [] }
  const files = payload.files
  if (files.length === 0) {
    return <div className="text-xs text-muted-foreground">No files.</div>
  }

  const handleFolderToggle = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const handleFileClick = async (path: string) => {
    await openFileInPreviewTab(path)
  }

  return (
    <div className="text-xs">
      <FileTree
        items={files}
        expandedFolders={expandedFolders}
        selectedPath={null}
        onFileClick={handleFileClick}
        onFolderToggle={handleFolderToggle}
      />
      {payload.truncated && payload.totalFound !== undefined && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          (showing {files.length} of {payload.totalFound} files)
        </div>
      )}
    </div>
  )
}
