import { useState, useEffect } from 'react'
import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { Loader2, CheckCircle, XCircle, AlertTriangle, ExternalLink, Download, Trash2 } from 'lucide-react'

interface McpStatus {
  installed: boolean
  version: string | null
  appVersion: string
  needsUpdate: boolean
  configPath: string
  serverPath: string
}

export function McpIntegration() {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isInstalling, setIsInstalling] = useState(false)
  const [isUninstalling, setIsUninstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Load status on mount
  useEffect(() => {
    loadStatus()
  }, [])

  const loadStatus = async () => {
    if (!window.api?.mcpGetStatus) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.api.mcpGetStatus()
      setStatus(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check status')
    } finally {
      setIsLoading(false)
    }
  }

  const handleInstall = async () => {
    if (!window.api?.mcpInstall) return

    setIsInstalling(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const result = await window.api.mcpInstall()
      if (result.success) {
        setSuccessMessage('MCP server installed. Please restart Claude Desktop to use Prose tools.')
        await loadStatus()
      } else {
        setError(result.error || 'Installation failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed')
    } finally {
      setIsInstalling(false)
    }
  }

  const handleUninstall = async () => {
    if (!window.api?.mcpUninstall) return

    setIsUninstalling(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const result = await window.api.mcpUninstall()
      if (result.success) {
        setSuccessMessage('MCP server removed. Please restart Claude Desktop.')
        await loadStatus()
      } else {
        setError(result.error || 'Uninstallation failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Uninstallation failed')
    } finally {
      setIsUninstalling(false)
    }
  }

  const handleUpdate = async () => {
    // Update is just reinstall
    await handleInstall()
  }

  return (
    <div className="space-y-4">
      <div className="space-y-0.5">
        <Label>Claude Desktop Integration</Label>
        <p className="text-xs text-muted-foreground">
          Enable Claude Desktop to read and edit documents in Prose using MCP tools
        </p>
      </div>

      {/* Status display */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Status:</span>
        {isLoading ? (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking...
          </span>
        ) : status?.installed ? (
          status.needsUpdate ? (
            <span className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Update available (v{status.version} → v{status.appVersion})
            </span>
          ) : (
            <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
              <CheckCircle className="h-4 w-4" />
              Installed (v{status.version})
            </span>
          )
        ) : (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <XCircle className="h-4 w-4" />
            Not installed
          </span>
        )}
      </div>

      {/* Info box when not installed */}
      {!isLoading && !status?.installed && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <p className="text-sm">
            Installing the MCP server allows Claude Desktop to:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
            <li>Read the current document content</li>
            <li>Get the document outline</li>
            <li>Open files in Prose</li>
            <li>Suggest edits to your document</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            If Prose isn't running, Claude will automatically launch it when needed.
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Success message */}
      {successMessage && (
        <p className="text-sm text-green-600 dark:text-green-400">{successMessage}</p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {!status?.installed ? (
          <Button
            onClick={handleInstall}
            disabled={isInstalling || isLoading}
          >
            {isInstalling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Installing...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Install MCP Server
              </>
            )}
          </Button>
        ) : (
          <>
            {status.needsUpdate && (
              <Button
                onClick={handleUpdate}
                disabled={isInstalling || isLoading}
              >
                {isInstalling ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Updating...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Update
                  </>
                )}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleUninstall}
              disabled={isUninstalling || isLoading}
              className="text-destructive hover:text-destructive"
            >
              {isUninstalling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Removing...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Uninstall
                </>
              )}
            </Button>
          </>
        )}
      </div>

      {/* Learn more link */}
      <p className="text-xs text-muted-foreground">
        Learn more about{' '}
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          Model Context Protocol
          <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </div>
  )
}
