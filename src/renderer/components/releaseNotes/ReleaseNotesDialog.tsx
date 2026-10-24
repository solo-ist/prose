import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { useSettingsStore } from '../../stores/settingsStore'
import { getApi } from '../../lib/browserApi'
import { APP_VERSION } from '../../buildInfo.generated'
import { RenderedNotes } from './renderNotes'

/**
 * Post-update release notes (#1058).
 *
 * Opening is decided in `App.tsx` (it owns the settings-loaded gate and the
 * `lastSeenVersion` compare); this component only renders what it is handed and
 * records the version on dismiss. `lastSeenVersion` is written on close rather than
 * on open, so a crash mid-modal shows the notes again instead of swallowing them.
 */
export function ReleaseNotesDialog({ markdown }: { markdown: string }) {
  const isOpen = useSettingsStore((s) => s.isReleaseNotesOpen)
  const setOpen = useSettingsStore((s) => s.setReleaseNotesOpen)
  const setLastSeenVersion = useSettingsStore((s) => s.setLastSeenVersion)

  const [mcpNeedsUpdate, setMcpNeedsUpdate] = useState(false)
  const [mcpState, setMcpState] = useState<'idle' | 'working' | 'done'>('idle')
  const [mcpError, setMcpError] = useState<string | null>(null)

  const isMasBuild = !!window.api?.isMasBuild

  // Ask #1056's fingerprint check whether the MCP surface actually changed. MAS has
  // no MCP integration at all (the main-process handler short-circuits to
  // all-false), so the button is absent there while the rest of the modal works.
  useEffect(() => {
    if (!isOpen || isMasBuild) return
    let cancelled = false
    void (async () => {
      try {
        const status = await getApi().mcpGetStatus?.()
        if (!cancelled) setMcpNeedsUpdate(!!status?.installed && !!status?.needsUpdate)
      } catch {
        if (!cancelled) setMcpNeedsUpdate(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, isMasBuild])

  const handleClose = () => {
    setOpen(false)
    setLastSeenVersion(APP_VERSION)
  }

  const handleUpdateMcp = async () => {
    setMcpError(null)
    setMcpState('working')
    try {
      const result = await getApi().mcpInstall?.()
      if (result?.success) {
        setMcpState('done')
      } else {
        setMcpState('idle')
        setMcpError(result?.error ?? 'Update failed')
      }
    } catch (e) {
      setMcpState('idle')
      setMcpError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-xl" data-testid="release-notes-dialog">
        <DialogHeader>
          <DialogTitle>What's new in Prose {APP_VERSION}</DialogTitle>
          <DialogDescription>
            A summary of the changes in the version you just updated to.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] pr-4">
          <RenderedNotes markdown={markdown} />
        </ScrollArea>

        {mcpError && (
          <p className="text-sm text-destructive" role="alert">
            {mcpError}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          {mcpNeedsUpdate ? (
            <Button
              variant="outline"
              onClick={handleUpdateMcp}
              disabled={mcpState !== 'idle'}
              data-testid="release-notes-update-mcp"
            >
              {mcpState === 'working'
                ? 'Updating MCP…'
                : mcpState === 'done'
                  ? 'MCP updated'
                  : 'Update MCP'}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={handleClose} data-testid="release-notes-dismiss">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
