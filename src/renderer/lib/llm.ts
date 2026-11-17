import type { Settings } from '../types'
import { getModelsForProvider, isKnownModel, type LLMProvider as LLMProviderType } from '../../shared/llm/models'
import { getProvider, PROVIDER_IDS, type ModelInfo } from '../../shared/llm/providers'
import { modelNames } from '../../shared/llm/modelNames'

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LLMResponse {
  content: string
  error?: string
}

export interface LLMProvider {
  chat(messages: LLMMessage[]): Promise<LLMResponse>
  stream(messages: LLMMessage[], onChunk: (chunk: string) => void): Promise<void>
}

export interface ValidationResult {
  valid: boolean
  error: string | null
  warnings: string[]
}

/**
 * Validate a typed API key's format for its provider, before it is tested or
 * saved. Returns null if valid, error message if invalid.
 */
export function validateApiKeyFormat(provider: LLMProviderType, apiKey: string): string | null {
  if (!apiKey || !apiKey.trim()) {
    return 'API key is required'
  }
  const { label, keyFormat } = getProvider(provider)
  if (keyFormat) {
    if (!apiKey.startsWith(keyFormat.prefix)) {
      return `${label} API keys should start with "${keyFormat.prefix}"`
    }
    if (apiKey.length < keyFormat.minLength) {
      return `${label} API key appears to be incomplete`
    }
  }
  return null
}

/** Each provider's live model list, as the settings store caches it (#1287). */
export type LiveModels = Partial<Record<LLMProviderType, ModelInfo[]>>

/**
 * Every model `provider` offers: its live list once fetched, else its seed,
 * each named by the one scheme (`modelNames`, #1322): `name` for menus,
 * `shortName` for the status bar.
 */
export function availableModelsFor(provider: LLMProviderType, live: LiveModels): ModelInfo[] {
  const fetched = live[provider]
  const models = fetched && fetched.length > 0 ? fetched : getModelsForProvider(provider)
  return models.map((m) => {
    const names = modelNames(provider, m.id, m.name)
    return { ...m, name: names.long, shortName: names.short }
  })
}

/** What the pickers need of the LLM settings: the model in use and the writer's shown sets. */
export type ModelChoice = Pick<Settings['llm'], 'provider' | 'model' | 'shownModels'>

/** The ids the pickers show for `provider`: the writer's set, else the provider's flagships (#1322). */
export function shownModelIds(provider: LLMProviderType, llm: Pick<ModelChoice, 'shownModels'>): string[] {
  return llm.shownModels?.[provider] ?? getProvider(provider).featuredModels
}

/**
 * The models a picker lists for `provider` (#1322): the shown set, in its
 * order, out of what the provider offers. The model in use is always listed,
 * and a set that matches nothing on offer (a stale default, everything
 * unchecked) lists every model rather than none.
 */
export function pickerModelsFor(provider: LLMProviderType, live: LiveModels, llm: ModelChoice): ModelInfo[] {
  const all = availableModelsFor(provider, live)
  const shown = shownModelIds(provider, llm)
  const listed = all
    .filter((m) => shown.includes(m.id))
    .sort((a, b) => shown.indexOf(a.id) - shown.indexOf(b.id))
  if (listed.length === 0) return all
  const inUse = provider === llm.provider ? all.find((m) => m.id === llm.model) : undefined
  return inUse && !listed.includes(inUse) ? [...listed, inUse] : listed
}

/** One provider's section of a model picker (#1287). */
export interface ModelGroup {
  provider: LLMProviderType
  label: string
  /** Whether main holds a key for it. Without one the group lists no models; pickers show an "Add a key" row. */
  hasKey: boolean
  /** What the pickers list: the shown set (#1322). */
  models: ModelInfo[]
  /** Everything the provider offers, for Settings → LLM, where the shown set is chosen. */
  allModels: ModelInfo[]
}

/**
 * Every provider's models, grouped in provider order (#1287). Settings, the
 * status bar and the model dialog all read this, through `useModelGroups()`,
 * so a model from any provider with a key is one pick away, and a provider
 * without one offers nothing that would fail.
 */
export function modelGroups(llm: ModelChoice & Pick<Settings['llm'], 'keyStatus'>, live: LiveModels): ModelGroup[] {
  return PROVIDER_IDS.map((provider) => {
    const hasKey = !!llm.keyStatus?.[provider]
    return {
      provider,
      label: getProvider(provider).label,
      hasKey,
      models: hasKey ? pickerModelsFor(provider, live, llm) : [],
      allModels: hasKey ? availableModelsFor(provider, live) : [],
    }
  })
}

/** "Add an OpenAI key": the call to action for a provider without one. */
export function addKeyLabel(label: string): string {
  return `Add ${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label} key`
}

/**
 * Whether main holds a key for `provider`, by default the one in use. The
 * renderer never sees the key (#1240), only the status main reports with the
 * settings.
 */
export function hasProviderKey(config: Settings['llm'], provider: LLMProviderType = config.provider): boolean {
  return !!config.keyStatus?.[provider]
}

/**
 * Validate URL format.
 * Returns null if valid, error message if invalid.
 */
export function validateUrl(url: string): string | null {
  if (!url) return null // Empty is OK (uses default)

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'URL must use http or https protocol'
    }
    return null
  } catch {
    return 'Invalid URL format'
  }
}

/**
 * Legacy validation function for backward compatibility.
 * Returns null if valid, error message if invalid.
 */
export function validateConfig(config: Settings['llm']): string | null {
  if (!config.model) {
    return 'No model specified'
  }

  if (!hasProviderKey(config)) {
    return 'No API key configured'
  }

  return null
}

/** Why AI can't be used right now, or `null` when it can. */
export type AIUnavailableReason = 'no-consent' | 'no-config'

export interface AIAvailability {
  available: boolean
  reason: AIUnavailableReason | null
}

/**
 * Single source of truth for "can the app make an AI request right now."
 * AI is available only when the user has consented to AI data disclosure
 * AND the LLM config validates (model + API key present). Every AI entry
 * point — chat send, comment/suggestion processing, auto-summaries — should
 * gate on this instead of ad-hoc `!!apiKey` / `validateConfig` checks so they
 * all agree on the same answer (and so the user gets one consistent message).
 *
 * Consent is requested by a launch-time modal independent of these controls,
 * so gating on it here never traps a user: declining consent disables AI
 * controls, and re-enabling lives in Settings.
 */
export function aiAvailability(settings: Settings): AIAvailability {
  if (!settings.aiConsent?.consented) return { available: false, reason: 'no-consent' }
  if (validateConfig(settings.llm) !== null) return { available: false, reason: 'no-config' }
  return { available: true, reason: null }
}

/** Boolean convenience wrapper around {@link aiAvailability}. */
export function isAIConfigured(settings: Settings): boolean {
  return aiAvailability(settings).available
}

/** User-facing copy for why AI is unavailable. Used by tooltips and toasts. */
export function aiUnavailableMessage(reason: AIUnavailableReason): string {
  return reason === 'no-consent'
    ? 'AI features are turned off. Enable them in Settings (⌘,) to use the assistant.'
    : 'AI isn’t configured. Add an API key in Settings (⌘,) to use the assistant.'
}

/**
 * Comprehensive configuration validation with warnings.
 */
export function validateConfigFull(config: Settings['llm']): ValidationResult {
  const warnings: string[] = []

  // Required: model
  if (!config.model) {
    return { valid: false, error: 'No model specified', warnings }
  }

  // Required: API key (its format was checked when it was typed)
  if (!hasProviderKey(config)) {
    return {
      valid: false,
      error: 'No API key configured',
      warnings
    }
  }

  // Validate base URL if provided
  if (config.baseUrl) {
    const urlError = validateUrl(config.baseUrl)
    if (urlError) {
      return { valid: false, error: `Base URL: ${urlError}`, warnings }
    }
  }

  // Check if model is known (warning only, not an error)
  if (!isKnownModel(config.provider, config.model)) {
    warnings.push(`Unknown model "${config.model}" - this may not work`)
  }

  return { valid: true, error: null, warnings }
}

/** The saved key's display form, from the last-four hint main reports. */
export function maskKeyHint(hint: string | undefined): string {
  return '••••••••' + (hint ?? '')
}

// Stub implementation - will be fully implemented later
export function createLLMProvider(_config: Settings['llm']): LLMProvider {
  return {
    async chat(_messages: LLMMessage[]): Promise<LLMResponse> {
      // TODO: Implement actual LLM calls
      return {
        content: 'LLM integration not yet implemented.',
        error: undefined
      }
    },

    async stream(_messages: LLMMessage[], onChunk: (chunk: string) => void): Promise<void> {
      // TODO: Implement streaming
      onChunk('LLM streaming not yet implemented.')
    }
  }
}
