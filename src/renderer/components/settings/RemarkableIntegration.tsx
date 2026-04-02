import { useState, useEffect } from 'react'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import { Switch } from '../ui/switch'
import { Loader2, ExternalLink, CheckCircle, XCircle, RefreshCw, Settings2, Key, Eye, EyeOff, FlaskConical } from 'lucide-react'
import { NotebookSelectionDialog } from './NotebookSelectionDialog'
import { useRemarkableEnabled } from '../../lib/featureFlags'
import { useSettingsStore } from '../../stores/settingsStore'
import type { Settings } from '../../types'

interface Props {
  settings: Settings
  setRemarkableConfig: (config: Partial<NonNullable<Settings['remarkable']>>) => void
}

/**
 * Check if the user has an Anthropic API key from their LLM settings
 */
function hasAnthropicLLMKey(settings: Settings): boolean {
  return settings.llm?.provider === 'anthropic' && !!settings.llm?.apiKey
}

export function RemarkableIntegration({ settings, setRemarkableConfig }: Props) {
  const enabled = useRemarkableEnabled()

  if (!enabled) {
    return <RemarkableWaitlist />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm text-amber-700 dark:text-amber-300">
          reMarkable Sync enabled via feature flag
        </span>
      </div>
      <RemarkableSettings settings={settings} setRemarkableConfig={setRemarkableConfig} />
    </div>
  )
}

function RemarkableWaitlist() {
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
        onClick={() => window.open('https://github.com/solo-ist/prose/issues/369', '_blank', 'noopener,noreferrer')}
      >
        <ExternalLink className="h-3.5 w-3.5 mr-2" />
        Express interest
      </Button>
    </div>
  )
}

function RemarkableSettings({ settings, setRemarkableConfig }: Props) {
  const { saveSettings } = useSettingsStore()
  const [code, setCode] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [showSelectionDialog, setShowSelectionDialog] = useState(false)
  const [hasSyncState, setHasSyncState] = useState<boolean | null>(null)

  // API key state
  const [apiKey, setApiKey] = useState('')
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false)
  const [isSavingApiKey, setIsSavingApiKey] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)

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

  // Check if sync state exists
  useEffect(() => {
    async function checkSyncState() {
      if (!remarkableSettings?.syncDirectory || !window.api) return

      try {
        const state = await window.api.remarkableGetSyncState(remarkableSettings.syncDirectory)
        setHasSyncState(state !== null)
      } catch {
        setHasSyncState(false)
      }
    }

    if (remarkableSettings?.enabled && isConnected) {
      checkSyncState()
    }
  }, [remarkableSettings?.enabled, remarkableSettings?.syncDirectory, isConnected])

  // Check if API key is stored
  useEffect(() => {
    async function checkApiKey() {
      if (!window.api) return

      try {
        const key = await window.api.remarkableGetApiKey()
        setHasStoredApiKey(!!key)
        if (!!key !== remarkableSettings?.hasAnthropicKey) {
          setRemarkableConfig({ hasAnthropicKey: !!key })
        }
      } catch {
        setHasStoredApiKey(false)
      }
    }

    if (remarkableSettings?.enabled) {
      checkApiKey()
    }
  }, [remarkableSettings?.enabled])

  const handleRegister = async () => {
    if (!window.api || !code.trim()) return

    setIsRegistering(true)
    setError(null)

    try {
      const response = await window.api.remarkableRegister(code.trim())
      const config: Partial<NonNullable<Settings['remarkable']>> = {
        deviceToken: response.deviceToken
      }
      if (!remarkableSettings?.syncDirectory) {
        config.syncDirectory = '~/Documents/reMarkable'
      }
      setRemarkableConfig(config)
      setIsConnected(true)
      setCode('')
      setShowSelectionDialog(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setIsRegistering(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.api) return

    try {
      await window.api.remarkableDisconnect(remarkableSettings?.syncDirectory)
    } catch {
      // Ignore disconnect errors
    }

    setRemarkableConfig({
      deviceToken: undefined,
      lastSyncedAt: undefined,
      hasAnthropicKey: false,
    })
    setHasSyncState(false)
    setIsConnected(false)
    setError(null)
    setSyncStatus(null)
    await saveSettings()
  }

  const handleSync = async () => {
    if (!window.api || !remarkableSettings?.deviceToken) return

    const syncDir = remarkableSettings.syncDirectory || '~/Documents/reMarkable'

    if (!hasSyncState) {
      setShowSelectionDialog(true)
      return
    }

    await performSync(syncDir)
  }

  const performSync = async (syncDir: string) => {
    if (!window.api || !remarkableSettings?.deviceToken) return

    setIsSyncing(true)
    setError(null)
    setSyncStatus('Starting sync...')

    // Subscribe to real-time progress events
    const unsubscribe = window.api.onRemarkableSyncProgress?.((progress) => {
      setSyncStatus(progress.message)
    })

    try {
      const result = await window.api.remarkableSync(remarkableSettings.deviceToken, syncDir)

      if (result.errors.length > 0) {
        setError(result.errors.join('; '))
      }

      setSyncStatus(`Synced ${result.synced} notebooks, ${result.skipped} unchanged`)
      setRemarkableConfig({ lastSyncedAt: result.syncedAt })
      setHasSyncState(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
      setSyncStatus(null)
    } finally {
      unsubscribe?.()
      setIsSyncing(false)
    }
  }

  const handleSelectionComplete = async () => {
    const syncDir = remarkableSettings?.syncDirectory || '~/Documents/reMarkable'
    await performSync(syncDir)
  }

  const handleSaveApiKey = async () => {
    if (!window.api || !apiKey.trim()) return

    setIsSavingApiKey(true)
    setApiKeyError(null)

    try {
      await window.api.remarkableStoreApiKey(apiKey.trim())
      setHasStoredApiKey(true)
      setRemarkableConfig({ hasAnthropicKey: true })
      setApiKey('')
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'Failed to save API key')
    } finally {
      setIsSavingApiKey(false)
    }
  }

  const handleClearApiKey = async () => {
    if (!window.api) return

    try {
      await window.api.remarkableClearApiKey()
      setHasStoredApiKey(false)
      setRemarkableConfig({ hasAnthropicKey: false })
      setApiKey('')
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'Failed to clear API key')
    }
  }

  const isEnabled = remarkableSettings?.enabled ?? false
  const hasToken = !!remarkableSettings?.deviceToken

  return (
    <>
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
          onCheckedChange={(checked) => {
            const config: Partial<NonNullable<Settings['remarkable']>> = { enabled: checked }
            if (checked && !remarkableSettings?.syncDirectory) {
              config.syncDirectory = '~/Documents/reMarkable'
            }
            setRemarkableConfig(config)
          }}
        />
      </div>

      {isEnabled && (
        <>
          <Separator />

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
                  onChange={(e) => setCode(e.target.value.toLowerCase())}
                  placeholder="abcdefgh"
                  maxLength={8}
                  className="flex-1 font-mono tracking-widest"
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

          <div className="space-y-2">
            <Label htmlFor="remarkable-syncdir">Sync Directory</Label>
            <div className="flex gap-2">
              <Input
                id="remarkable-syncdir"
                value={remarkableSettings?.syncDirectory || '~/Documents/reMarkable'}
                onChange={(e) => setRemarkableConfig({ syncDirectory: e.target.value })}
                placeholder="~/Documents/reMarkable"
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={async () => {
                  const result = await window.api?.selectFolder()
                  if (result) {
                    setRemarkableConfig({ syncDirectory: result.path })
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

          {hasAnthropicLLMKey(settings) ? (
            <p className="text-xs text-muted-foreground">
              Handwriting recognition uses your Anthropic API key from LLM settings.
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="remarkable-apikey">Anthropic API Key</Label>
              {hasStoredApiKey ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/30">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">API key configured</span>
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 ml-auto" />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearApiKey}
                    className="text-destructive hover:text-destructive"
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="remarkable-apikey"
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-ant-..."
                      className="pr-10 font-mono"
                      disabled={isSavingApiKey}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                  <Button
                    onClick={handleSaveApiKey}
                    disabled={isSavingApiKey || !apiKey.trim()}
                  >
                    {isSavingApiKey ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Saving...
                      </>
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Required for handwriting recognition (OCR). Get your key from{' '}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  console.anthropic.com
                </a>
              </p>
              {apiKeyError && (
                <p className="text-sm text-destructive">{apiKeyError}</p>
              )}
            </div>
          )}

          {syncStatus && (
            <p className="text-xs text-muted-foreground">{syncStatus}</p>
          )}

          {remarkableSettings?.lastSyncedAt && !syncStatus && (
            <p className="text-xs text-muted-foreground">
              Last synced: {new Date(remarkableSettings.lastSyncedAt).toLocaleString()}
            </p>
          )}

          {hasToken && (
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={handleSync}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Sync Now
                  </>
                )}
              </Button>
              {hasSyncState && (
                <Button
                  variant="outline"
                  onClick={() => setShowSelectionDialog(true)}
                  disabled={isSyncing}
                >
                  <Settings2 className="h-4 w-4 mr-2" />
                  Manage Notebooks
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleDisconnect}
                className="text-destructive hover:text-destructive"
              >
                Disconnect
              </Button>
            </div>
          )}
        </>
      )}

      {remarkableSettings?.deviceToken && (
        <NotebookSelectionDialog
          open={showSelectionDialog}
          onOpenChange={setShowSelectionDialog}
          deviceToken={remarkableSettings.deviceToken}
          syncDirectory={remarkableSettings.syncDirectory || '~/Documents/reMarkable'}
          onComplete={handleSelectionComplete}
        />
      )}
    </>
  )
}
