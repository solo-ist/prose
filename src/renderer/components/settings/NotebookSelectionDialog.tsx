import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { ScrollArea } from '../ui/scroll-area'
import { Loader2, Folder, FileText } from 'lucide-react'
import type { RemarkableCloudNotebook } from '../../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  deviceToken: string
  syncDirectory: string
  onComplete: () => void
}

export function NotebookSelectionDialog({
  open,
  onOpenChange,
  deviceToken,
  syncDirectory,
  onComplete
}: Props) {
  const [notebooks, setNotebooks] = useState<RemarkableCloudNotebook[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load notebooks from cloud when dialog opens
  useEffect(() => {
    if (!open || !window.api) return

    async function loadNotebooks() {
      setIsLoading(true)
      setError(null)
      try {
        const cloudNotebooks = await window.api.remarkableListCloudNotebooks(deviceToken)
        setNotebooks(cloudNotebooks)
        // Pre-select all notebooks by default
        const allIds = new Set(
          cloudNotebooks
            .filter(n => n.type === 'notebook')
            .map(n => n.id)
        )
        setSelectedIds(allIds)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load notebooks')
      } finally {
        setIsLoading(false)
      }
    }

    loadNotebooks()
  }, [open, deviceToken])

  const handleToggle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    const allNotebookIds = notebooks
      .filter(n => n.type === 'notebook')
      .map(n => n.id)
    setSelectedIds(new Set(allNotebookIds))
  }

  const handleSelectNone = () => {
    setSelectedIds(new Set())
  }

  const handleSave = async () => {
    if (!window.api) return

    setIsSaving(true)
    try {
      await window.api.remarkableUpdateSyncSelection(
        syncDirectory,
        Array.from(selectedIds)
      )
      onComplete()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save selection')
    } finally {
      setIsSaving(false)
    }
  }

  // Organize notebooks into folders
  const folders = notebooks.filter(n => n.type === 'folder')
  const notebooksOnly = notebooks.filter(n => n.type === 'notebook')

  // Group notebooks by parent
  const notebooksByParent = new Map<string | null, RemarkableCloudNotebook[]>()
  for (const notebook of notebooksOnly) {
    const parent = notebook.parent
    if (!notebooksByParent.has(parent)) {
      notebooksByParent.set(parent, [])
    }
    notebooksByParent.get(parent)!.push(notebook)
  }

  const selectedCount = selectedIds.size
  const totalCount = notebooksOnly.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Select Notebooks to Sync</DialogTitle>
          <DialogDescription>
            Choose which notebooks to sync from your reMarkable. Unselected notebooks will still appear in the cloud view.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-4 text-center text-destructive">{error}</div>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
              <span>{selectedCount} of {totalCount} selected</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                  Select All
                </Button>
                <Button variant="ghost" size="sm" onClick={handleSelectNone}>
                  Select None
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[300px] rounded-md border">
              <div className="p-4 space-y-1">
                {/* Root notebooks (no parent) */}
                {notebooksByParent.get(null)?.map(notebook => (
                  <NotebookItem
                    key={notebook.id}
                    notebook={notebook}
                    isSelected={selectedIds.has(notebook.id)}
                    onToggle={() => handleToggle(notebook.id)}
                  />
                ))}

                {/* Folders with their contents */}
                {folders.map(folder => {
                  const children = notebooksByParent.get(folder.id) || []
                  if (children.length === 0) return null

                  return (
                    <div key={folder.id} className="space-y-1">
                      <div className="flex items-center gap-2 py-1 text-muted-foreground">
                        <Folder className="h-4 w-4" />
                        <span className="text-sm font-medium">{folder.name}</span>
                      </div>
                      <div className="pl-6 space-y-1">
                        {children.map(notebook => (
                          <NotebookItem
                            key={notebook.id}
                            notebook={notebook}
                            isSelected={selectedIds.has(notebook.id)}
                            onToggle={() => handleToggle(notebook.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Save & Sync'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NotebookItem({
  notebook,
  isSelected,
  onToggle
}: {
  notebook: RemarkableCloudNotebook
  isSelected: boolean
  onToggle: () => void
}) {
  return (
    <label className="flex items-center gap-2 py-1 cursor-pointer hover:bg-muted/50 rounded px-2 -mx-2">
      <Checkbox checked={isSelected} onCheckedChange={onToggle} />
      <FileText className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm flex-1">{notebook.name}</span>
      {notebook.fileType && (
        <span className="text-xs text-muted-foreground">
          {notebook.fileType}
        </span>
      )}
    </label>
  )
}
