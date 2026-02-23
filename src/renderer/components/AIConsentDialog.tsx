import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from './ui/alert-dialog'
import { useSettingsStore } from '../stores/settingsStore'

export function AIConsentDialog() {
  const isOpen = useSettingsStore((s) => s.isAIConsentDialogOpen)
  const setAIConsent = useSettingsStore((s) => s.setAIConsent)
  const setAIConsentDialogOpen = useSettingsStore((s) => s.setAIConsentDialogOpen)

  const handleEnable = () => {
    setAIConsent(true)
  }

  const handleDecline = () => {
    setAIConsent(false)
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => {
      if (!open) setAIConsentDialogOpen(false)
    }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>AI Writing Assistance</AlertDialogTitle>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Prose can optionally connect to AI services to help with your writing.
            Before enabling this feature, please review how it works:
          </p>
          <ul className="space-y-2">
            <li className="flex gap-2">
              <span className="shrink-0">•</span>
              <span>
                <strong className="text-foreground">What is sent:</strong> When you use the AI
                assistant, selected text and document content are sent to an external AI provider
                (such as Anthropic).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0">•</span>
              <span>
                <strong className="text-foreground">Your API key:</strong> AI features require
                your own API key (BYOK). Prose does not store or access your content on any
                server — requests go directly from your device to the provider.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0">•</span>
              <span>
                <strong className="text-foreground">Entirely optional:</strong> Prose works as a
                full-featured markdown editor without AI. You can enable or disable AI features
                at any time in Settings → LLM.
              </span>
            </li>
          </ul>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleDecline}>
            Use Without AI
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleEnable}>
            Enable AI Features
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
