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
          <p className="mb-2 font-medium">Keyboard shortcuts:</p>
          <div className="space-y-1">
            <p>
              <kbd className="rounded bg-muted px-1.5 py-0.5">⌘N</kbd> New &nbsp;
              <kbd className="rounded bg-muted px-1.5 py-0.5">⌘O</kbd> Open &nbsp;
              <kbd className="rounded bg-muted px-1.5 py-0.5">⌘S</kbd> Save
            </p>
            <p>
              <kbd className="rounded bg-muted px-1.5 py-0.5">⌘\</kbd> Chat &nbsp;
              <kbd className="rounded bg-muted px-1.5 py-0.5">⇧⌘H</kbd> Files &nbsp;
              <kbd className="rounded bg-muted px-1.5 py-0.5">F1</kbd> All shortcuts
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
