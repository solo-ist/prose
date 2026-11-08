import { useState } from 'react'
import { Eye, EyeOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { maskKeyHint, validateApiKeyFormat } from '../../lib/llm'
import { useSettingsStore } from '../../stores/settingsStore'
import { PROVIDERS, PROVIDER_IDS, type LLMKeyStatusMap, type LLMProvider } from '../../../shared/llm/providers'

/** A typed key per provider, held by the dialog until Save Changes hands it to main. `undefined` = not editing. */
export type KeyDrafts = Partial<Record<LLMProvider, string>>

/** A draft's format problem, or null. An empty draft has none (nothing to save). */
export function draftFormatError(provider: LLMProvider, drafts: KeyDrafts): string | null {
  const draft = drafts[provider]?.trim()
  return draft ? validateApiKeyFormat(provider, draft) : null
}

interface ProviderKeysProps {
  active: LLMProvider
  keyStatus: LLMKeyStatusMap | undefined
  drafts: KeyDrafts
  onDraftChange: (provider: LLMProvider, draft: string | undefined) => void
  /** A save error from the last Save Changes, per provider. */
  saveErrors: Partial<Record<LLMProvider, string>>
}

/**
 * Every provider's key, side by side (#1242). Main holds the keys (#1240), so
 * each row shows only its status and acts on its own key; switching the
 * provider in use never touches a key.
 */
export function ProviderKeys({ active, keyStatus, drafts, onDraftChange, saveErrors }: ProviderKeysProps) {
  return (
    <div className="space-y-2">
      {PROVIDER_IDS.map((provider) => (
        <ProviderKeyRow
          key={provider}
          provider={provider}
          active={provider === active}
          saved={keyStatus?.[provider]}
          draft={drafts[provider]}
          formatError={draftFormatError(provider, drafts)}
          onDraftChange={(draft) => onDraftChange(provider, draft)}
          saveError={saveErrors[provider]}
        />
      ))}
    </div>
  )
}

interface RowProps {
  provider: LLMProvider
  active: boolean
  saved: LLMKeyStatusMap[LLMProvider]
  draft: string | undefined
  formatError: string | null
  onDraftChange: (draft: string | undefined) => void
  saveError: string | undefined
}

function ProviderKeyRow({ provider, active, saved, draft, formatError, onDraftChange, saveError }: RowProps) {
  const clearLlmKey = useSettingsStore((s) => s.clearLlmKey)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const { label } = PROVIDERS[provider]

  // The provider in use with no key opens straight onto its field.
  const editing = draft !== undefined || (!saved && active)
  const typed = (draft ?? '').trim()
  const requiredError = editing && !typed && !saved && active ? 'API key is required' : null

  const setDraft = (value: string | undefined) => {
    setTestResult(null)
    onDraftChange(value)
  }

  const test = async () => {
    if (editing && (!typed || formatError)) return
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(
        window.api?.testApiKey
          ? await window.api.testApiKey({ provider, ...(editing && typed ? { apiKey: typed } : {}) })
          : { success: true, message: 'API key format is valid (connection test not available in browser)' }
      )
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : 'Failed to test API key' })
    } finally {
      setTesting(false)
    }
  }

  const clear = async () => {
    setTestResult(null)
    onDraftChange(undefined)
    await clearLlmKey(provider)
  }

  const testButton = (disabled: boolean) => (
    <Button variant="outline" size="sm" onClick={() => void test()} disabled={disabled || testing}>
      {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
    </Button>
  )

  const message = saveError
    ? { success: false, message: saveError }
    : testResult

  return (
    <div className="rounded-md border border-border p-3 space-y-2" data-testid={`llm-key-row-${provider}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {active && <span className="text-xs text-muted-foreground">in use</span>}
        <span className="flex-1 text-right text-xs text-muted-foreground" data-testid={`llm-key-status-${provider}`}>
          {saved
            ? `Key saved ${maskKeyHint(saved.hint)}${saved.persisted === false ? ' (this session only)' : ''}`
            : 'No key'}
        </span>
        {!editing && saved && (
          <>
            {testButton(false)}
            <Button variant="outline" size="sm" onClick={() => setDraft('')}>Replace</Button>
            <Button variant="outline" size="sm" onClick={() => void clear()}>Clear</Button>
          </>
        )}
        {!editing && !saved && (
          <Button variant="outline" size="sm" onClick={() => setDraft('')}>Add key</Button>
        )}
      </div>

      {editing && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id={`apiKey-${provider}`}
              aria-label={`${label} API key`}
              type={showKey ? 'text' : 'password'}
              value={draft ?? ''}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`${saved ? 'Enter a new' : 'Enter your'} ${label} API key`}
              autoComplete="off"
              spellCheck={false}
              className={formatError ? 'border-amber-500 pr-10' : 'pr-10'}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowKey(!showKey)}
              tabIndex={-1}
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {testButton(!typed || !!formatError)}
          {(saved || !active) && (
            <Button variant="ghost" size="sm" onClick={() => setDraft(undefined)}>
              {saved ? 'Keep saved key' : 'Cancel'}
            </Button>
          )}
        </div>
      )}

      {(formatError || requiredError) && (
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {formatError || requiredError}
        </p>
      )}
      {message && (
        <p className={`text-xs flex items-center gap-1 ${
          message.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
        }`}>
          {message.success ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
          {message.message}
        </p>
      )}
      {editing && typed && !formatError && (
        <p className="text-xs text-muted-foreground">Saved when you click Save Changes.</p>
      )}
    </div>
  )
}
