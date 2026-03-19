import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { ExternalLink } from 'lucide-react'
import type { Settings } from '../../types'

interface Props {
  settings: Settings
  setGoogleConfig: (config: Partial<NonNullable<Settings['google']>> | undefined) => void
}

export function GoogleDocsIntegration({ settings: _settings, setGoogleConfig: _setGoogleConfig }: Props) {
  return (
    <div className="space-y-4">
      <div className="space-y-0.5">
        <Label>Google Docs</Label>
        <p className="text-xs text-muted-foreground">
          Coming in v1.1
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          Bidirectional sync with Google Docs is being prepared for a future release.
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => window.open('https://github.com/solo-ist/prose/issues/120', '_blank', 'noopener,noreferrer')}
      >
        <ExternalLink className="h-4 w-4 mr-2" />
        Express interest
      </Button>
    </div>
  )
}
