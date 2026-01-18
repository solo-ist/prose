import { useState, useEffect } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel
} from '../ui/alert-dialog'
import { useSettings } from '../../hooks/useSettings'

export function DefaultHandlerPrompt() {
  const [open, setOpen] = useState(false)
  const { settings, isLoaded, setFileAssociationConfig } = useSettings()

  useEffect(() => {
    if (!isLoaded) return

    // Only show prompt on first run if not already prompted
    const hasBeenPrompted = settings?.fileAssociation?.hasBeenPrompted
    if (!hasBeenPrompted) {
      // Check if already default before showing prompt
      const checkDefault = async () => {
        if (window.api?.fileAssociationIsDefault) {
          const isDefault = await window.api.fileAssociationIsDefault()
          // Only skip prompt if we KNOW we're already default (true)
          // If null (unknown) or false, show the prompt
          if (isDefault === true) {
            // Already default, mark as prompted and don't show dialog
            setFileAssociationConfig({ hasBeenPrompted: true })
            return
          }
        }
        // Not default or unknown, show prompt after a delay
        setTimeout(() => setOpen(true), 1000)
      }
      checkDefault()
    }
  }, [isLoaded, settings?.fileAssociation?.hasBeenPrompted, setFileAssociationConfig])

  const handleDone = () => {
    setFileAssociationConfig({ hasBeenPrompted: true })
    setOpen(false)
  }

  const handleAskLater = () => {
    setOpen(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Make Prose Your Default Markdown Editor</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>To open .md files directly in Prose from Finder:</p>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Right-click any <code className="bg-muted px-1 rounded">.md</code> file in Finder</li>
                <li>Select <strong>Get Info</strong> (or press ⌘I)</li>
                <li>Under "Open with:", select <strong>Prose</strong></li>
                <li>Click <strong>Change All...</strong> to apply to all .md files</li>
              </ol>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={handleAskLater}>Remind Me Later</AlertDialogCancel>
          <AlertDialogAction onClick={handleDone}>
            Got It
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
