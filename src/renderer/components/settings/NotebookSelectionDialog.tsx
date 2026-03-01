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
import { Loader2, Folder, FileText, ChevronRight, ChevronDown } from 'lucide-react'
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
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  // Load notebooks from cloud and existing sync state when dialog opens
  useEffect(() => {
    if (!open || !window.api) return

    async function loadNotebooks() {
      setIsLoading(true)
      setError(null)
      try {
        // Load cloud notebooks and existing sync state in parallel
        const [cloudNotebooks, existingSyncState] = await Promise.all([
          window.api.remarkableListCloudNotebooks(deviceToken),
          window.api.remarkableGetSyncState(syncDirectory)
        ])
        setNotebooks(cloudNotebooks)

        // Use existing selection if available, otherwise select none (first time)
        if (existingSyncState?.selectedNotebooks) {
          const selectedSet = new Set(existingSyncState.selectedNotebooks)
          setSelectedIds(selectedSet)
          // Auto-expand folders containing selected notebooks
          const foldersToExpand = new Set<string>()
          for (const notebook of cloudNotebooks) {
            if (notebook.type === 'notebook' && selectedSet.has(notebook.id) && notebook.parent) {
              let current: string | null = notebook.parent
              while (current) {
                foldersToExpand.add(current)
                current = cloudNotebooks.find(n => n.id === current)?.parent ?? null
              }
            }
          }
          setExpandedFolders(foldersToExpand)
        } else {
          // First time - start with nothing selected so user explicitly chooses
          setSelectedIds(new Set())
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load notebooks')
      } finally {
        setIsLoading(false)
      }
    }

    loadNotebooks()
  }, [open, deviceToken, syncDirectory])

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
    // Expand all folders so selections are visible
    setExpandedFolders(new Set(notebooks.filter(n => n.type === 'folder').map(n => n.id)))
  }

  const handleSelectNone = () => {
    setSelectedIds(new Set())
  }

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
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

  // Organize notebooks and folders by parent for hierarchical display
  const itemsByParent = new Map<string | null, RemarkableCloudNotebook[]>()
  for (const item of notebooks) {
    const parent = item.parent
    if (!itemsByParent.has(parent)) {
      itemsByParent.set(parent, [])
    }
    itemsByParent.get(parent)!.push(item)
  }

  const notebooksOnly = notebooks.filter(n => n.type === 'notebook')
  const selectedCount = selectedIds.size
  const totalCount = notebooksOnly.length

  // Check if a folder has any notebook descendants (not just direct children)
  const hasNotebookDescendants = (folderId: string): boolean => {
    const children = itemsByParent.get(folderId) || []
    return children.some(child =>
      child.type === 'notebook' || (child.type === 'folder' && hasNotebookDescendants(child.id))
    )
  }

  // Recursive function to render folder tree
  const renderItems = (parentId: string | null, depth: number = 0): React.ReactNode => {
    const children = itemsByParent.get(parentId) || []
    if (children.length === 0) return null

    // Sort: folders first, then alphabetically
    const sorted = [...children].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return sorted.map(item => {
      if (item.type === 'folder') {
        // Skip folders with no notebook descendants
        if (!hasNotebookDescendants(item.id)) return null

        const isExpanded = expandedFolders.has(item.id)

        return (
          <div key={item.id} className="space-y-1" style={{ paddingLeft: depth > 0 ? '1.5rem' : 0 }}>
            <button
              type="button"
              className="flex items-center gap-1 py-1 text-muted-foreground hover:text-foreground transition-colors w-full text-left"
              onClick={() => toggleFolder(item.id)}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              <Folder className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">{item.name}</span>
            </button>
            {isExpanded && renderItems(item.id, depth + 1)}
          </div>
        )
      } else {
        return (
          <div key={item.id} style={{ paddingLeft: depth > 0 ? '1.5rem' : 0 }}>
            <NotebookItem
              notebook={item}
              isSelected={selectedIds.has(item.id)}
              onToggle={() => handleToggle(item.id)}
            />
          </div>
        )
      }
    })
  }

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
                {renderItems(null)}
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
