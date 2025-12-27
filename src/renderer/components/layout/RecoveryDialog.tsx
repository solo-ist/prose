import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Button } from '../ui/button'

interface RecoveryDialogProps {
  open: boolean
  onRecover: () => void
  onDiscard: () => void
}

export function RecoveryDialog({
  open,
  onRecover,
  onDiscard
}: RecoveryDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Recover unsaved work?</DialogTitle>
          <DialogDescription>
            We found an unsaved document from your last session. Would you like
            to recover it?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2 sm:justify-end">
          <Button variant="outline" onClick={onDiscard}>
            Discard
          </Button>
          <Button onClick={onRecover}>Recover</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
