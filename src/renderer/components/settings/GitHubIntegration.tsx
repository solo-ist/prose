import { useState, useEffect } from 'react'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Loader2, CheckCircle, XCircle, Github, Trash2 } from 'lucide-react'

/**
 * Settings panel for configuring a GitHub Personal Access Token (PAT).
 *
 * The token is stored via the OS-encrypted credential store (safeStorage) in
 * the main process — the renderer never sees the token value after saving it.
 * The component only holds the token in local state while the user is actively
 * typing in the input; once saved the local copy is cleared.
 *
 * Gate: desktop-only, non-MAS. Callers must render this component only when
 * `!isWebMode() && !window.api?.isMasBuild`.
 */
export function GitHubIntegration() {
  const [tokenInput, setTokenInput] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [connectedLogin, setConnectedLogin] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Check whether a token is already stored on mount
  useEffect(() => {
    let cancelled = false
    async function checkToken() {
      const hasToken = await window.api?.githubHasToken?.()
      if (cancelled) return
      if (hasToken) {
        // Silently test the stored token to get the login name
        const result = await window.api?.githubTestToken?.()
        if (cancelled) return
        if (result?.success && result.login) {
          setIsConnected(true)
          setConnectedLogin(result.login)
        } else {
          // Token exists but is no longer valid (revoked/expired)
          setIsConnected(false)
          setConnectedLogin(null)
          setError('Your stored token appears invalid. Please enter a new one.')
        }
      }
    }
    checkToken()
    return () => { cancelled = true }
  }, [])

  const handleSave = async () => {
    const token = tokenInput.trim()
    if (!token) return

    setError(null)
    setSuccessMsg(null)
    setIsSaving(true)

    try {
      // Store first, then test
      const storeResult = await window.api?.githubStoreToken?.(token)
      if (!storeResult?.success) {
        setError(storeResult?.error ?? 'Failed to save token.')
        return
      }

      // Test the newly stored token
      const testResult = await window.api?.githubTestToken?.()
      if (testResult?.success && testResult.login) {
        setIsConnected(true)
        setConnectedLogin(testResult.login)
        setTokenInput('') // Clear from local state now it's saved securely
        setSuccessMsg(`Connected as @${testResult.login}`)
      } else {
        // Invalid token — clear it from the store
        await window.api?.githubClearToken?.()
        setError(testResult?.error ?? 'Token validation failed.')
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async () => {
    setError(null)
    setSuccessMsg(null)
    setIsTesting(true)
    try {
      const result = await window.api?.githubTestToken?.()
      if (result?.success && result.login) {
        setConnectedLogin(result.login)
        setSuccessMsg(`Token is valid — authenticated as @${result.login}`)
      } else {
        setError(result?.error ?? 'Token validation failed.')
      }
    } finally {
      setIsTesting(false)
    }
  }

  const handleRemove = async () => {
    setError(null)
    setSuccessMsg(null)
    setIsRemoving(true)
    try {
      await window.api?.githubClearToken?.()
      setIsConnected(false)
      setConnectedLogin(null)
      setTokenInput('')
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <Github className="h-4 w-4" />
          <Label>GitHub</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Connect a Personal Access Token to file issues directly from chat via{' '}
          <span className="font-mono">/report-bug</span> and{' '}
          <span className="font-mono">/request-feature</span>.
        </p>
      </div>

      {isConnected && connectedLogin ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span>
              Connected as{' '}
              <span className="font-mono font-medium">@{connectedLogin}</span>
            </span>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={isTesting}
            >
              {isTesting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : null}
              Verify token
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRemove}
              disabled={isRemoving}
              className="text-destructive hover:text-destructive"
            >
              {isRemoving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              Remove token
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="github-pat" className="text-xs">
              Personal Access Token
            </Label>
            <Input
              id="github-pat"
              type="password"
              placeholder="ghp_..."
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tokenInput.trim()) handleSave()
              }}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Needs{' '}
              <span className="font-mono">repo</span> scope (or{' '}
              <span className="font-mono">public_repo</span> for public repos).{' '}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground transition-colors"
                onClick={() =>
                  window.api?.openExternal?.(
                    'https://github.com/settings/tokens/new?scopes=public_repo&description=Prose+issue+reporter'
                  )
                }
              >
                Create one on GitHub
              </button>
              .
            </p>
          </div>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={!tokenInput.trim() || isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : null}
            Save token
          </Button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-start gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}
    </div>
  )
}
