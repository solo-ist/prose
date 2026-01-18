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
  const { settings, updateSettings, isLoaded } = useSettings()

  useEffect(() => {
    if (!isLoaded) return

    // Only show prompt on first run if not already prompted
    const hasBeenPrompted = settings?.fileAssociation?.hasBeenPrompted
    if (!hasBeenPrompted) {
      // Small delay to let the app fully initialize
      const timer = setTimeout(() => {
        setOpen(true)
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [isLoaded, settings?.fileAssociation?.hasBeenPrompted])

  const handleSetDefault = async () => {
    if (window.api?.fileAssociationSetDefault) {
      const success = await window.api.fileAssociationSetDefault()
      await updateSettings({
        fileAssociation: {
          hasBeenPrompted: true,
          setAsDefault: success
        }
      })
    }
    setOpen(false)
  }

  const handleDecline = async () => {
    await updateSettings({
      fileAssociation: {
        hasBeenPrompted: true,
        setAsDefault: false
      }
    })
    setOpen(false)
  }

  const handleAskLater = () => {
    // Don't mark as prompted so we ask again next time
    setOpen(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Set as Default Markdown Editor?</AlertDialogTitle>
          <AlertDialogDescription>
            Would you like to make Prose your default app for opening markdown files (.md)?
            This will let you open markdown files directly from Finder or your file manager.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={handleAskLater}>Ask Later</AlertDialogCancel>
          <AlertDialogAction variant="outline" onClick={handleDecline}>
            No Thanks
          </AlertDialogAction>
          <AlertDialogAction onClick={handleSetDefault}>
            Yes, Set as Default
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
