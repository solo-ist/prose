import { useState, useEffect } from 'react'
import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { Loader2, CheckCircle, XCircle, ExternalLink } from 'lucide-react'
import type { Settings, GoogleConnectionStatus } from '../../types'

interface Props {
  settings: Settings
  setGoogleConfig: (config: Partial<NonNullable<Settings['google']>> | undefined) => void
}

export function GoogleDocsIntegration({ settings, setGoogleConfig }: Props) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<GoogleConnectionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null)

  const googleSettings = settings.google

  // Check if Google OAuth credentials are configured, then check connection status
  useEffect(() => {
    async function checkConfig() {
      if (window.api?.googleIsConfigured) {
        const configured = await window.api.googleIsConfigured()
        setIsConfigured(configured)
        if (!configured) return
      } else {
        setIsConfigured(false)
        return
      }

      if (!window.api?.googleGetConnectionStatus) return

      setIsValidating(true)
      try {
        const status = await window.api.googleGetConnectionStatus()
        setConnectionStatus(status)

        // Update settings if connection state changed
        if (status.connected && status.email) {
          if (!googleSettings || googleSettings.email !== status.email || googleSettings.picture !== status.picture) {
            setGoogleConfig({
              email: status.email,
              picture: status.picture,
              connectedAt: googleSettings?.connectedAt || new Date().toISOString()
            })
          }
        } else if (!status.connected && googleSettings) {
          // Connection lost, clear settings
          setGoogleConfig(undefined)
        }

        if (status.error) {
          setError(status.error)
        }
      } catch (err) {
        setConnectionStatus({ connected: false })
      } finally {
        setIsValidating(false)
      }
    }

    checkConfig()
  }, [])

  const handleConnect = async () => {
    if (!window.api?.googleStartAuth) return

    setIsConnecting(true)
    setError(null)

    try {
      const result = await window.api.googleStartAuth()

      if (result.success && result.email) {
        setConnectionStatus({ connected: true, email: result.email, picture: result.picture })

        // Ensure the sync folder exists
        let syncDirectory: string | undefined
        if (window.api?.googleEnsureFolder) {
          try {
            syncDirectory = await window.api.googleEnsureFolder()
          } catch (err) {
            console.error('Failed to create Google Docs folder:', err)
          }
        }

        setGoogleConfig({
          email: result.email,
          picture: result.picture,
          connectedAt: new Date().toISOString(),
          syncDirectory
        })
      } else {
        setError(result.error || 'Failed to connect')
        setConnectionStatus({ connected: false })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
      setConnectionStatus({ connected: false })
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.api?.googleDisconnect) return

    try {
      await window.api.googleDisconnect()
      setConnectionStatus({ connected: false })
      setGoogleConfig(undefined)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    }
  }

  const isConnected = connectionStatus?.connected ?? false
  const displayEmail = connectionStatus?.email || googleSettings?.email

  // While loading or when credentials aren't configured, show placeholder
  if (isConfigured !== true) {
    if (isConfigured === null) return null // Still checking
    return (
      <div className="space-y-4">
        <div className="space-y-0.5">
          <Label>Google Docs</Label>
          <p className="text-xs text-muted-foreground">
            Google Docs sync — coming soon
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-0.5">
        <Label>Google Docs</Label>
        <p className="text-xs text-muted-foreground">
          Sync your documents with Google Docs for cross-device access.
        </p>
      </div>

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
            Connected as {displayEmail}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <XCircle className="h-4 w-4" />
            Not connected
          </span>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {!isConnected ? (
          <Button
            onClick={handleConnect}
            disabled={isConnecting || isValidating}
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Connecting...
              </>
            ) : (
              'Connect Google Account'
            )}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={handleDisconnect}
              className="text-destructive hover:text-destructive"
            >
              Disconnect
            </Button>
          </>
        )}
      </div>

      {/* Info about sync */}
      {isConnected && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
          <p className="text-sm font-medium">How to sync</p>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>
              <span className="font-medium">Sync:</span> File {'>'} Sync with Google Docs (Cmd+Shift+G)
            </li>
            <li>
              <span className="font-medium">Import:</span> File {'>'} Import from Google Docs (Cmd+Shift+I)
            </li>
          </ul>
          <p className="text-xs text-muted-foreground mt-2">
            Documents are saved to ~/Documents/Google Docs/
          </p>
        </div>
      )}

      {/* Not connected info */}
      {!isConnected && !isValidating && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">
            Connect your Google account to push and pull documents to/from Google Docs.
            Your documents will be stored in your own Google Drive.
          </p>
        </div>
      )}

      {/* Connected timestamp */}
      {isConnected && googleSettings?.connectedAt && (
        <p className="text-xs text-muted-foreground">
          Connected since: {new Date(googleSettings.connectedAt).toLocaleString()}
        </p>
      )}
    </div>
  )
}
