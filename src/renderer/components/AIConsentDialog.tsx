import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from './ui/alert-dialog'
import { Checkbox } from './ui/checkbox'
import { useSettingsStore } from '../stores/settingsStore'

type Step = 'consent' | 'skill'

export function AIConsentDialog() {
  const isOpen = useSettingsStore((s) => s.isAIConsentDialogOpen)
  const setAIConsent = useSettingsStore((s) => s.setAIConsent)
  const setErrorTracking = useSettingsStore((s) => s.setErrorTracking)
  const setAIConsentDialogOpen = useSettingsStore((s) => s.setAIConsentDialogOpen)
  const [errorReportingChecked, setErrorReportingChecked] = useState(true)
  const [step, setStep] = useState<Step>('consent')
  const [downloading, setDownloading] = useState(false)
  const [skillError, setSkillError] = useState<string | null>(null)

  const isMasBuild = !!window.api?.isMasBuild

  const handleEnable = (event: React.MouseEvent) => {
    setAIConsent(true)
    setErrorTracking(errorReportingChecked)
    // OSS users get a one-click handoff to the Prose Skill on the same surface.
    // MAS can't ship the skill (sandbox), so let AlertDialogAction's default close fire.
    if (isMasBuild) {
      setStep('consent')
    } else {
      // AlertDialogAction auto-closes on click — preventDefault to keep it open
      // for the skill step.
      event.preventDefault()
      setStep('skill')
    }
  }

  const handleDecline = () => {
    setAIConsent(false)
    setErrorTracking(errorReportingChecked)
    setAIConsentDialogOpen(false)
    setStep('consent')
  }

  const handleSkipSkill = () => {
    setAIConsentDialogOpen(false)
    setStep('consent')
  }

  const handleDownloadSkill = async (event: React.MouseEvent) => {
    setSkillError(null)
    setDownloading(true)
    // Hold the dialog open while the download runs; only let it close on success.
    event.preventDefault()
    try {
      const result = await window.api?.downloadSkill?.()
      if (result?.success) {
        setAIConsentDialogOpen(false)
        setStep('consent')
      } else {
        setSkillError(result?.error ?? 'Download failed')
      }
    } catch (e) {
      setSkillError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        setAIConsentDialogOpen(false)
        setStep('consent')
      }
    }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {step === 'consent' ? 'Welcome to Prose' : 'One more thing — the Claude Skill'}
          </AlertDialogTitle>
        </AlertDialogHeader>

        {step === 'consent' ? (
          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="space-y-3">
              <p className="font-medium text-foreground">AI Writing Assistance</p>
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
                    at any time in Settings.
                  </span>
                </li>
              </ul>
            </div>

            <div className="border-t pt-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={errorReportingChecked}
                  onCheckedChange={(checked) => setErrorReportingChecked(checked === true)}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-foreground font-medium">Help improve Prose</span>
                  <p className="mt-0.5">
                    Send anonymous crash reports to help us find and fix bugs.
                    No document content is ever included. You can change this
                    anytime in Settings.
                  </p>
                </div>
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>
              Prose ships a Claude Skill that teaches Claude how to outline, read, and propose
              edits to your Prose documents. Download it now and upload to claude.ai under
              <strong className="text-foreground"> Customize → Skills</strong>.
            </p>
            <p className="text-xs">
              You can re-download anytime from Settings → Integrations or the toolbar menu.
            </p>
            {skillError && (
              <p className="text-xs text-destructive">{skillError}</p>
            )}
          </div>
        )}

        <AlertDialogFooter>
          {step === 'consent' ? (
            <>
              <AlertDialogCancel onClick={handleDecline}>
                Use Without AI
              </AlertDialogCancel>
              <AlertDialogAction onClick={handleEnable}>
                Enable AI Features
              </AlertDialogAction>
            </>
          ) : (
            <>
              <AlertDialogCancel onClick={handleSkipSkill} disabled={downloading}>
                Skip
              </AlertDialogCancel>
              <AlertDialogAction onClick={handleDownloadSkill} disabled={downloading}>
                {downloading ? 'Downloading…' : 'Download Claude Skill'}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
