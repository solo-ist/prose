import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'

export function StatusBar() {
  const { document, cursorPosition } = useEditor()
  const { settings } = useSettings()

  const wordCount = document.content
    .split(/\s+/)
    .filter((word) => word.length > 0).length

  const charCount = document.content.length

  return (
    <div className="flex h-6 items-center justify-between border-t border-border bg-muted/30 px-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        <span>
          Ln {cursorPosition.line}, Col {cursorPosition.column}
        </span>
        <span>{wordCount} words</span>
        <span>{charCount} characters</span>
      </div>

      <div className="flex items-center gap-4">
        {document.isDirty && (
          <span className="text-yellow-500">Unsaved changes</span>
        )}
        <span>{settings.llm.provider}</span>
      </div>
    </div>
  )
}
