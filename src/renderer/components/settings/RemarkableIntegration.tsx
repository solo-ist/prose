import { useState, useEffect } from 'react'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import { Switch } from '../ui/switch'
import { Loader2, ExternalLink, CheckCircle, XCircle } from 'lucide-react'
import type { Settings } from '../../types'

interface Props {
  settings: Settings
  setRemarkableConfig: (config: Partial<NonNullable<Settings['remarkable']>>) => void
}

export function RemarkableIntegration({ settings, setRemarkableConfig }: Props) {
  const [code, setCode] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remarkableSettings = settings.remarkable

  // Validate existing token on mount
  useEffect(() => {
    async function validateExistingToken() {
      if (!remarkableSettings?.deviceToken || !window.api) return

      setIsValidating(true)
      try {
        const valid = await window.api.remarkableValidate(remarkableSettings.deviceToken)
        setIsConnected(valid)
        if (!valid) {
          setError('Device token expired. Please reconnect.')
        }
      } catch {
        setIsConnected(false)
      } finally {
        setIsValidating(false)
      }
    }

    if (remarkableSettings?.enabled) {
      validateExistingToken()
    }
  }, [remarkableSettings?.enabled, remarkableSettings?.deviceToken])

  const handleRegister = async () => {
    if (!window.api || !code.trim()) return

    setIsRegistering(true)
    setError(null)

    try {
      const response = await window.api.remarkableRegister(code.trim())
      setRemarkableConfig({ deviceToken: response.deviceToken })
      setIsConnected(true)
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setIsRegistering(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.api) return

    try {
      await window.api.remarkableDisconnect()
    } catch {
      // Ignore disconnect errors
    }

    setRemarkableConfig({ deviceToken: undefined })
    setIsConnected(false)
    setError(null)
  }

  const isEnabled = remarkableSettings?.enabled ?? false
  const hasToken = !!remarkableSettings?.deviceToken

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="remarkable-enabled">reMarkable Sync</Label>
          <p className="text-xs text-muted-foreground">
            Sync notebooks from your reMarkable tablet
          </p>
        </div>
        <Switch
          id="remarkable-enabled"
          checked={isEnabled}
          onCheckedChange={(checked) => setRemarkableConfig({ enabled: checked })}
        />
      </div>

      {isEnabled && (
        <>
          <Separator />

          {/* Connection status */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status:</span>
            {isValidating ? (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking...
              </span>
            ) : isConnected ? (
              <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <XCircle className="h-4 w-4" />
                Not connected
              </span>
            )}
          </div>

          {/* Registration flow (when not connected) */}
          {!hasToken && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-sm">To connect your reMarkable:</p>
              <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
                <li>
                  Go to{' '}
                  <a
                    href="https://my.remarkable.com/device/desktop/connect"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    my.remarkable.com
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Enter the 8-letter code below</li>
              </ol>

              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABCDEFGH"
                  maxLength={8}
                  className="flex-1 font-mono uppercase tracking-widest"
                  disabled={isRegistering}
                />
                <Button
                  onClick={handleRegister}
                  disabled={isRegistering || code.length !== 8}
                >
                  {isRegistering ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Connecting...
                    </>
                  ) : (
                    'Connect'
                  )}
                </Button>
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
          )}

          {/* Sync directory (always shown when enabled) */}
          <div className="space-y-2">
            <Label htmlFor="remarkable-syncdir">Sync Directory</Label>
            <div className="flex gap-2">
              <Input
                id="remarkable-syncdir"
                value={remarkableSettings?.syncDirectory || ''}
                onChange={(e) => setRemarkableConfig({ syncDirectory: e.target.value })}
                placeholder="~/Documents/Remarkable"
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={async () => {
                  const folder = await window.api?.selectFolder()
                  if (folder) {
                    setRemarkableConfig({ syncDirectory: folder })
                  }
                }}
              >
                Browse...
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Where synced notebooks will be saved
            </p>
          </div>

          {/* Last synced timestamp */}
          {remarkableSettings?.lastSyncedAt && (
            <p className="text-xs text-muted-foreground">
              Last synced: {new Date(remarkableSettings.lastSyncedAt).toLocaleString()}
            </p>
          )}

          {/* Disconnect button (when connected) */}
          {hasToken && (
            <Button
              variant="outline"
              onClick={handleDisconnect}
              className="text-destructive hover:text-destructive"
            >
              Disconnect
            </Button>
          )}
        </>
      )}
    </div>
  )
}
