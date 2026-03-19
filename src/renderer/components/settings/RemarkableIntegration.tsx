import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { ExternalLink } from 'lucide-react'
import type { Settings } from '../../types'

interface Props {
  settings: Settings
  setRemarkableConfig: (config: Partial<NonNullable<Settings['remarkable']>>) => void
}

export function RemarkableIntegration({ settings: _settings, setRemarkableConfig: _setRemarkableConfig }: Props) {
  return (
    <div className="space-y-2">
      <Label>reMarkable Sync</Label>
      <p className="text-xs text-muted-foreground font-medium">Coming in v1.1</p>
      <p className="text-xs text-muted-foreground">
        Sync handwritten notebooks from your reMarkable tablet. This feature is being prepared
        for a future release.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-1"
        onClick={() => window.open('https://github.com/solo-ist/prose/issues/356', '_blank', 'noopener,noreferrer')}
      >
        <ExternalLink className="h-3.5 w-3.5 mr-2" />
        Express interest
      </Button>
    </div>
  )
}
