import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Separator } from '../ui/separator'
import { ProseMark } from '../ProseMark'

import { APP_VERSION, GIT_HASH } from '../../buildInfo.generated'

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Identified by testid, not by text: the release-notes modal (#1058) is
          also a dialog whose title contains "Prose", so a text filter matches
          both whenever they are open together. */}
      <DialogContent className="max-w-sm" data-testid="about-dialog">
        <DialogHeader>
          <DialogTitle className="text-center">Prose</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <ProseMark tile title="Prose" className="h-16 w-16 rounded-[22%]" />

          <div className="text-center space-y-1">
            <p className="text-sm text-muted-foreground">
              Version {APP_VERSION} <span className="text-muted-foreground/60">({GIT_HASH})</span>
            </p>
            <p className="text-sm text-muted-foreground">
              A minimal markdown editor with AI chat
            </p>
          </div>

          <Separator className="my-2" />

          <div className="text-center space-y-2 text-xs text-muted-foreground">
            <p>Built with Electron, React, and TipTap</p>
            <p>
              <a
                href="https://github.com/solo-ist/prose"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                github.com/solo-ist/prose
              </a>
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
