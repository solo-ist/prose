import { useState } from 'react'
import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { Download, ExternalLink, Sparkles, Loader2 } from 'lucide-react'

export function ProseSkillIntegration() {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleDownload = async () => {
    setError(null)
    setSuccess(false)
    setDownloading(true)
    try {
      const result = await window.api?.downloadSkill?.()
      if (result?.success) {
        setSuccess(true)
      } else {
        setError(result?.error ?? 'Download failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-0.5">
        <Label className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Claude Skill
        </Label>
        <p className="text-xs text-muted-foreground">
          Teach Claude how to outline, read, and propose edits to your Prose documents.
          Download the skill bundle, then upload it to claude.ai under Customize → Skills.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button onClick={handleDownload} disabled={downloading} variant="default">
          {downloading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Downloading…
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Download Skill
            </>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={() => window.open('https://claude.ai/settings/customize', '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Open claude.ai
        </Button>
      </div>

      {success && (
        <p className="text-xs text-green-600 dark:text-green-400">
          Saved to your Downloads folder. Drag the .skill file into claude.ai → Customize → Skills.
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}
