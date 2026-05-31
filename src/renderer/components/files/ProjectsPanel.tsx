/**
 * ProjectsPanel — displays the list of Projects and Favorites when the user
 * activates the 'projects' or 'favorites' view mode in the file explorer.
 *
 * Design: both lists live in the same component (controlled by a tab), so
 * the header toggle buttons can stay consistent with the rest of FileListPanel.
 */
import { useState } from 'react'
import { FolderOpen, Plus, Trash2, Star, Folder, ChevronRight, Boxes } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '../ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { ScrollArea } from '../ui/scroll-area'
import { cn } from '../../lib/utils'
import {
  useProjectsStore,
  useProjects,
  useFavorites,
  useActiveProject,
} from '../../stores/projectsStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabs } from '../../hooks/useTabs'

// ---- sub-types -------------------------------------------------------

interface ProjectItemProps {
  id: string
  name: string
  path: string
  isActive: boolean
  onSwitch: (id: string) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}

function ProjectItem({ id, name, path, isActive, onSwitch, onRename, onRemove }: ProjectItemProps) {
  const folderName = path.split('/').pop() || path
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          className={cn(
            'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50',
            isActive && 'bg-muted'
          )}
          onClick={() => onSwitch(id)}
          title={path}
        >
          <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{name}</div>
            {name !== folderName && (
              <div className="truncate text-xs text-muted-foreground">{folderName}</div>
            )}
          </div>
          {isActive && (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onSwitch(id)}>
          <FolderOpen className="h-4 w-4 mr-2" />
          Open
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRename(id, name)}>
          <Folder className="h-4 w-4 mr-2" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onRemove(id)}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface FavoriteItemProps {
  id: string
  name: string
  path: string
  onNavigate: (id: string) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}

function FavoriteItem({ id, name, path, onNavigate, onRename, onRemove }: FavoriteItemProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
          onClick={() => onNavigate(id)}
          title={path}
        >
          <Star className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate">{name}</div>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onNavigate(id)}>
          <FolderOpen className="h-4 w-4 mr-2" />
          Open
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRename(id, name)}>
          <Folder className="h-4 w-4 mr-2" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onRemove(id)}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ---- main component --------------------------------------------------

export type ProjectsPanelMode = 'projects' | 'favorites'

interface ProjectsPanelProps {
  mode: ProjectsPanelMode
}

export function ProjectsPanel({ mode }: ProjectsPanelProps) {
  const projects = useProjects()
  const favorites = useFavorites()
  const activeProject = useActiveProject()
  const {
    addProjectFromPicker,
    addFavoriteFromPicker,
    switchToProject,
    navigateToFavorite,
    removeProject,
    removeFavorite,
    isAddingProject,
    isAddingFavorite,
    operationError,
    setOperationError,
  } = useProjectsStore()
  const { openFileInTab } = useTabs()

  // Rename dialog state
  const [renameTarget, setRenameTarget] = useState<{
    type: 'project' | 'favorite'
    id: string
    name: string
  } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const handleRenameOpen = (type: 'project' | 'favorite', id: string, name: string) => {
    setRenameTarget({ type, id, name })
    setRenameValue(name)
    setOperationError(null)
  }

  const handleRenameConfirm = () => {
    if (!renameTarget || !renameValue.trim()) return
    const settingsStore = useSettingsStore.getState()
    if (renameTarget.type === 'project') {
      settingsStore.updateProject(renameTarget.id, { name: renameValue.trim() })
    } else {
      settingsStore.updateFavorite(renameTarget.id, { name: renameValue.trim() })
    }
    setRenameTarget(null)
    setRenameValue('')
  }

  // Remove confirmation dialog state
  const [removeTarget, setRemoveTarget] = useState<{
    type: 'project' | 'favorite'
    id: string
    name: string
  } | null>(null)

  const handleRemoveConfirm = () => {
    if (!removeTarget) return
    if (removeTarget.type === 'project') {
      removeProject(removeTarget.id)
    } else {
      removeFavorite(removeTarget.id)
    }
    setRemoveTarget(null)
  }

  if (mode === 'projects') {
    return (
      <div className="flex h-full flex-col">
        <ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <FolderOpen className="h-8 w-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground mb-1">No projects yet.</p>
              <p className="text-xs text-muted-foreground/70 mb-4">
                Projects are root folders with their own context — like Obsidian vaults.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => addProjectFromPicker(true)}
                disabled={isAddingProject}
              >
                <Plus className="h-4 w-4 mr-1" />
                {isAddingProject ? 'Choosing...' : 'Add Project'}
              </Button>
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {[...projects]
                .sort((a, b) => {
                  // Sort by lastOpenedAt desc, then createdAt desc
                  const aTime = a.lastOpenedAt ?? a.createdAt
                  const bTime = b.lastOpenedAt ?? b.createdAt
                  return bTime.localeCompare(aTime)
                })
                .map((project) => (
                  <ProjectItem
                    key={project.id}
                    id={project.id}
                    name={project.name}
                    path={project.path}
                    isActive={activeProject?.id === project.id}
                    onSwitch={(id) => switchToProject(id)}
                    onRename={(id, name) => handleRenameOpen('project', id, name)}
                    onRemove={(id) => {
                      const p = projects.find((x) => x.id === id)
                      if (p) setRemoveTarget({ type: 'project', id, name: p.name })
                    }}
                  />
                ))}
            </div>
          )}
        </ScrollArea>

        {/* Add button at the bottom when there are existing projects */}
        {projects.length > 0 && (
          <div className="border-t border-border p-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={() => addProjectFromPicker(true)}
                  disabled={isAddingProject}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {isAddingProject ? 'Choosing...' : 'Add Project'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add a folder as a new project</TooltipContent>
            </Tooltip>
          </div>
        )}

        {operationError && (
          <div className="px-3 py-2 text-xs text-destructive border-t border-border">
            {operationError}
          </div>
        )}

        {/* Rename dialog */}
        <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename {renameTarget?.type === 'project' ? 'Project' : 'Favorite'}</DialogTitle>
              <DialogDescription>
                Enter a new display name.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="rename-value">Name</Label>
                <Input
                  id="rename-value"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameConfirm()
                  }}
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</Button>
              <Button onClick={handleRenameConfirm} disabled={!renameValue.trim()}>Rename</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Remove confirmation dialog */}
        <Dialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove Project?</DialogTitle>
              <DialogDescription>
                This removes <strong>{removeTarget?.name}</strong> from your projects list.
                The folder and its files are not deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRemoveTarget(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleRemoveConfirm}>Remove</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // Favorites mode
  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block">
        {favorites.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <Star className="h-8 w-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-1">No favorites yet.</p>
            <p className="text-xs text-muted-foreground/70 mb-4">
              Star folders for quick navigation across all projects.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => addFavoriteFromPicker()}
              disabled={isAddingFavorite}
            >
              <Plus className="h-4 w-4 mr-1" />
              {isAddingFavorite ? 'Choosing...' : 'Add Favorite'}
            </Button>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {[...favorites]
              .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
              .map((fav) => (
                <FavoriteItem
                  key={fav.id}
                  id={fav.id}
                  name={fav.name}
                  path={fav.path}
                  onNavigate={(id) => {
                    const f = favorites.find((x) => x.id === id)
                    if (f && f.isDirectory === false) {
                      void openFileInTab(f.path)
                    } else {
                      void navigateToFavorite(id)
                    }
                  }}
                  onRename={(id, name) => handleRenameOpen('favorite', id, name)}
                  onRemove={(id) => {
                    const f = favorites.find((x) => x.id === id)
                    if (f) setRemoveTarget({ type: 'favorite', id, name: f.name })
                  }}
                />
              ))}
          </div>
        )}
      </ScrollArea>

      {/* Add button at the bottom */}
      {favorites.length > 0 && (
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground hover:text-foreground"
            onClick={() => addFavoriteFromPicker()}
            disabled={isAddingFavorite}
          >
            <Plus className="h-4 w-4 mr-1" />
            {isAddingFavorite ? 'Choosing...' : 'Add Favorite'}
          </Button>
        </div>
      )}

      {operationError && (
        <div className="px-3 py-2 text-xs text-destructive border-t border-border">
          {operationError}
        </div>
      )}

      {/* Rename dialog (shared between modes; only one dialog open at a time) */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Favorite</DialogTitle>
            <DialogDescription>Enter a new display name.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rename-value-fav">Name</Label>
              <Input
                id="rename-value-fav"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameConfirm()
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button onClick={handleRenameConfirm} disabled={!renameValue.trim()}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <Dialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Favorite?</DialogTitle>
            <DialogDescription>
              This removes <strong>{removeTarget?.name}</strong> from your favorites.
              The folder and its files are not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRemoveConfirm}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
