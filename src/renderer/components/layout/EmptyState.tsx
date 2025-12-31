import { FileText, FolderOpen, PenLine } from 'lucide-react'
import { Button } from '../ui/button'
import { useEditor } from '../../hooks/useEditor'

export function EmptyState() {
  const { openFile, newFile } = useEditor()

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <PenLine className="h-8 w-8 text-primary" />
        </div>

        <h2 className="mb-2 text-xl font-semibold">Start Writing</h2>
        <p className="mb-6 text-muted-foreground">
          Create a new document or open an existing markdown file to get started.
        </p>

        <div className="flex gap-3">
          <Button variant="outline" onClick={openFile}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Open File
          </Button>
          <Button onClick={() => newFile()}>
            <FileText className="mr-2 h-4 w-4" />
            New Document
          </Button>
        </div>

        <div className="mt-8 text-xs text-muted-foreground">
          <p className="mb-1">Keyboard shortcuts:</p>
          <p>
            <kbd className="rounded bg-muted px-1.5 py-0.5">Cmd+N</kbd> New &nbsp;
            <kbd className="rounded bg-muted px-1.5 py-0.5">Cmd+O</kbd> Open
          </p>
        </div>
      </div>
    </div>
  )
}
