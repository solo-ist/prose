/**
 * The LLM providers Prose Agents can use, and what each one needs.
 *
 * One entry per provider. Main reads it to call the provider and to find the
 * provider's key; the renderer reads it for the model picker and the key field.
 * Anthropic is the only entry today; OpenAI (#1241) and Inference Coop (#956)
 * add theirs.
 */

export interface ModelInfo {
  id: string
  name: string
  description?: string
}

export type LLMProvider = 'anthropic'

/** How main talks to the provider. */
export type ProviderTransport = 'anthropic'

export interface ProviderInfo {
  id: LLMProvider
  label: string
  transport: ProviderTransport
  /** The API root main calls. Fixed per provider; the renderer never supplies it. */
  baseURL: string
  /** The `credentialStore` key holding this provider's API key. */
  credentialKey: string
  /** The static model seed, shown until (or instead of) the live list. */
  models: ModelInfo[]
  /** Where the model picker's list comes from: the provider's live list, else the seed. */
  modelsSource: 'live+static'
  defaultModel: string
  /** The model for lightweight internal calls: key checks, summaries, tab emoji. */
  smallModel: string
  /** Whether the Claude adaptive-thinking parameters apply to this provider's models. */
  thinking: boolean
  /** A format check for a typed key, before it is tested against the provider. */
  keyFormat?: { prefix: string; minLength: number }
}

/**
 * The key status the renderer may see. Never the key: `hint` is its last four
 * characters, for the "Key saved" line.
 */
export interface LLMKeyStatus {
  hint: string
  /** False when secure storage is unavailable: the key lives in main's memory for this session only. */
  persisted: boolean
}

export type LLMKeyStatusMap = Partial<Record<LLMProvider, LLMKeyStatus>>

export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fastest, most economical' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', description: 'Best balance of speed and intelligence' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', description: 'Most capable model' },
]

export const PROVIDERS: Record<LLMProvider, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    transport: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    // The name predates multiple providers; kept so keys saved before 1.9.1 still resolve.
    credentialKey: 'llm-api-key',
    models: ANTHROPIC_MODELS,
    modelsSource: 'live+static',
    defaultModel: 'claude-sonnet-5-5',
    smallModel: 'claude-haiku-4-5',
    thinking: true,
    keyFormat: { prefix: 'sk-ant-', minLength: 40 },
  },
}

export const PROVIDER_IDS = Object.keys(PROVIDERS) as LLMProvider[]

export function isProvider(id: unknown): id is LLMProvider {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, id)
}

/**
 * The provider's entry. An unknown id falls back to Anthropic, the default
 * provider, so a settings file written by a newer build (naming a provider this
 * one doesn't know) still renders instead of crashing. That makes the fallback
 * a display convenience only: **any path that uses a key or calls a provider
 * must gate with `isProvider` first**, as every main-process handler does, so
 * an unknown id is refused rather than sent to Anthropic's base URL with
 * Anthropic's key.
 */
export function getProvider(id: string): ProviderInfo {
  return isProvider(id) ? PROVIDERS[id] : PROVIDERS.anthropic
}
