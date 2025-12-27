import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { FileText, Clock, FolderOpen } from 'lucide-react'
import { Button } from '../ui/button'

export function EmptyState() {
  const { openFile, openRecentFile, newFile } = useEditor()
  const { settings } = useSettings()

  const recentFiles = settings.recentFiles || []

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="max-w-md space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Welcome to Prose</h1>
          <p className="text-muted-foreground">
            A distraction-free writing app with AI assistance
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={newFile}
          >
            <FileText className="mr-2 h-4 w-4" />
            New Document
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={openFile}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            Open File...
          </Button>
        </div>

        {recentFiles.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Recent Documents</span>
            </div>
            <div className="space-y-1">
              {recentFiles.slice(0, 5).map((file) => (
                <button
                  key={file.path}
                  onClick={() => openRecentFile(file.path)}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-accent transition-colors text-sm"
                >
                  <div className="font-medium truncate">{file.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {file.path}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
