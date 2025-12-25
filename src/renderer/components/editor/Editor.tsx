import { useEffect } from 'react'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'

export function Editor() {
  const { document, cursorPosition } = useEditor()
  const { settings } = useSettings()

  useEffect(() => {
    // Placeholder: TipTap editor will be initialized here
  }, [])

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex-1 overflow-auto p-8 md:p-12 lg:p-16"
        style={{
          fontSize: `${settings.editor.fontSize}px`,
          lineHeight: settings.editor.lineHeight,
          fontFamily: settings.editor.fontFamily
        }}
      >
        <div className="max-w-3xl mx-auto">
          {/* Placeholder for TipTap editor */}
          <div className="prose prose-invert max-w-none">
            {document.content ? (
              <div className="whitespace-pre-wrap text-foreground/90">
                {document.content}
              </div>
            ) : (
              <p className="text-muted-foreground italic">
                Start writing, or open a file...
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Debug info - will be removed */}
      <div className="hidden">
        Line {cursorPosition.line}, Column {cursorPosition.column}
      </div>
    </div>
  )
}
