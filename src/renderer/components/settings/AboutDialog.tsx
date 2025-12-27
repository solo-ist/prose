import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Separator } from '../ui/separator'

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">Prose</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
            <span className="text-3xl font-bold text-primary">P</span>
          </div>

          <div className="text-center space-y-1">
            <p className="text-sm text-muted-foreground">Version 1.0.0</p>
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
