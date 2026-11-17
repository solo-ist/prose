/**
 * The LLM providers Prose Agents can use, and what each one needs.
 *
 * One entry per provider. Main reads it to call the provider and to find the
 * provider's key; the renderer reads it for the model picker and the key field.
 * Anthropic speaks its own API. OpenAI speaks the Responses API through
 * src/main/responses.ts (#1301): its newer models take tools with reasoning
 * only there. OpenAI-compatible gateways (Inference Coop, #956) speak Chat
 * Completions through src/main/chatCompletions.ts.
 */

export interface ModelInfo {
  id: string
  /** The long name, for menus ("Claude Sonnet 5.5"); see `./modelNames`. */
  name: string
  /** The short name, for the status bar ("Sonnet 5.5"). Set where lists are built for display. */
  shortName?: string
  description?: string
}

export type LLMProvider = 'anthropic' | 'openai' | 'inference-coop'

/**
 * How main talks to the provider: Anthropic's Messages API through its SDK,
 * OpenAI's Responses API through `src/main/responses.ts`, or the Chat
 * Completions API (OpenAI-compatible gateways such as LiteLLM) through
 * `src/main/chatCompletions.ts`. Every switch on it in main is exhaustive, so
 * a new transport fails to compile until each path handles it.
 */
export type ProviderTransport = 'anthropic' | 'responses' | 'chat-completions'

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
  /**
   * The models the pickers show until the writer chooses their own set in
   * Settings → LLM (#1322), in the order shown: the flagships, not every model
   * the key reaches. Includes `defaultModel`.
   */
  featuredModels: string[]
  defaultModel: string
  /** The model for lightweight internal calls: key checks, summaries, tab emoji. */
  smallModel: string
  /** Whether the Claude adaptive-thinking parameters apply to this provider's models. */
  thinking: boolean
  /** A format check for a typed key, before it is tested against the provider. */
  keyFormat?: { prefix: string; minLength: number }
  /** Where a writer creates a key (onboarding and Settings link to it). */
  keysUrl: string
  /**
   * True when the key page is also where one joins or pays (the co-op's
   * dashboard): the App Store build names no link to it (#956).
   */
  keysLinkDirectOnly?: boolean
  /** Where the account's credits are managed, named when the provider says it has none (#1268). */
  billingHint: string
  /**
   * Which ids from the provider's live model list are chat models. OpenAI's
   * `/v1/models` also lists embeddings, audio, image and Responses-only models.
   */
  liveModels?: { include?: RegExp; exclude?: RegExp }
  /**
   * Responses API hints (#1301). They are first guesses only: the adapter
   * learns what a model really accepts from the provider's refusals.
   */
  responses?: {
    /** Whether the model reasons, so takes a `reasoning` parameter and the thinking toggle. */
    reasons: (model: string) => boolean
    /** The lowest `reasoning.effort` to try first when thinking is off. */
    offEffort: (model: string) => string
  }
  /** Chat Completions request tuning; read through `chatCompletionsTuning`. */
  chatCompletions?: {
    /**
     * The `reasoning_effort` to send for a model, or undefined to send none:
     * per model, since non-reasoning models (gpt-4.1) reject the parameter
     * (#1271). A3's co-op answers 'none' for every model.
     */
    reasoningEffortFor?: (model: string) => string | undefined
    /**
     * Extra `max_completion_tokens` for a model that reasons: its hidden
     * reasoning counts against the limit, so without room a long tool call
     * could be cut off.
     */
    reasoningHeadroom?: number
  }
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

/**
 * A seed shown until a key is saved and the live list replaces it. Checked
 * against the live list at the first live smoke (the operator's key).
 */
export const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-5.5', name: 'OpenAI GPT 5.5' },
  { id: 'gpt-6-luna', name: 'OpenAI Luna 6' },
  { id: 'gpt-6-sol', name: 'OpenAI Sol 6' },
]

/**
 * The Inference Cooperative's gateway (LiteLLM, #956). The seed is the three
 * models the 2026-10-19 probes showed completing Prose's tool loop; the live
 * list adds whatever chat models the member's key can reach.
 */
export const INFERENCE_COOP_MODELS: ModelInfo[] = [
  { id: 'greenpt/deepseek-v4.1-flash', name: 'GreenPT DeepSeek 4.1', description: 'The co-op\'s default; renewable energy' },
  { id: 'tinfoil/deepseek-v4-1-flash', name: 'Tinfoil DeepSeek 4.1', description: 'Runs in a secure enclave' },
  { id: 'tinfoil/glm-5.3', name: 'Tinfoil GLM 5.3', description: 'Flagship; runs in a secure enclave' },
]

export const PROVIDERS: Record<LLMProvider, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    transport: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    // The name predates multiple providers; kept so keys saved before 1.10.0 still resolve.
    credentialKey: 'llm-api-key',
    models: ANTHROPIC_MODELS,
    modelsSource: 'live+static',
    featuredModels: ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    defaultModel: 'claude-sonnet-5-5',
    smallModel: 'claude-haiku-4-5',
    thinking: true,
    keyFormat: { prefix: 'sk-ant-', minLength: 40 },
    keysUrl: 'https://console.anthropic.com/settings/keys',
    billingHint: 'console.anthropic.com → Settings → Billing',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    transport: 'responses',
    baseURL: 'https://api.openai.com/v1',
    credentialKey: 'llm-api-key-openai',
    models: OPENAI_MODELS,
    modelsSource: 'live+static',
    // The newest of each line, and the default.
    featuredModels: ['gpt-5.5', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6.1-terra'],
    defaultModel: 'gpt-5.5',
    // Internal calls only (key checks, summaries), so it needn't be on the picker's list.
    smallModel: 'gpt-5-mini',
    thinking: false,
    keyFormat: { prefix: 'sk-', minLength: 20 },
    keysUrl: 'https://platform.openai.com/api-keys',
    billingHint: 'platform.openai.com → Settings → Billing',
    responses: {
      reasons: (model) => isOpenAIReasoningModel(model),
      // The first gpt-5 generation's lowest effort is "minimal"; later models
      // take "none", or refuse it and say what they take, which the adapter
      // then uses.
      offEffort: (model) => (/^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(model) ? 'minimal' : 'none'),
    },
    // GPT-5.5 and newer, by version, without dated snapshots (#1311); an older
    // or dated id can still be typed as a custom model.
    liveModels: {
      include: /^gpt-(5\.([5-9]|\d{2,})|[6-9]|\d{2,})(?![\d])/,
      exclude: /(audio|realtime|transcribe|tts|image|embedding|search|instruct|moderation|codex|computer-use|deep-research|-pro\b|-\d{4}-\d{2}-\d{2}$)/,
    },
  },
  'inference-coop': {
    id: 'inference-coop',
    label: 'Inference Coop',
    // The co-op's one documented route (docs.inference.coop, "API access").
    transport: 'chat-completions',
    baseURL: 'https://gateway.inference.coop/v1',
    credentialKey: 'llm-api-key-inference-coop',
    models: INFERENCE_COOP_MODELS,
    modelsSource: 'live+static',
    featuredModels: [
      'tinfoil/deepseek-v4-1-flash',
      'tinfoil/glm-5.3',
      'greenpt/deepseek-v4.1-flash',
      'regolo/qwen3.5-122b',
      'regolo/gemma4-31b',
      'regolo/apertus-70b',
    ],
    defaultModel: 'greenpt/deepseek-v4.1-flash',
    smallModel: 'greenpt/deepseek-v4.1-flash',
    thinking: false,
    keyFormat: { prefix: 'sk-', minLength: 10 },
    keysUrl: 'https://dashboard.inference.coop',
    keysLinkDirectOnly: true,
    billingHint: 'dashboard.inference.coop',
    chatCompletions: {
      // Thinking off for every model: left on, the Tinfoil models spend the
      // whole output budget reasoning before a tool call (the 2026-10-19 probes).
      reasoningEffortFor: () => 'none',
    },
    // The gateway also lists speech, image and embedding models. greenpt/glm-5.3
    // is left out: its tool calls failed 3 of 3 in the probes (its -flash and
    // the Tinfoil build are separate entries and stay).
    liveModels: {
      exclude: /(whisper|voxtral|tts|embed|image|^greenpt\/glm-5\.3$)/,
    },
  },
}

export const PROVIDER_IDS = Object.keys(PROVIDERS) as LLMProvider[]

/**
 * OpenAI models that reason: everything but the gpt-4 and gpt-3.5 lines and
 * the chat-tuned aliases (`gpt-5-chat-latest`, `chatgpt-4o-latest`). A newer
 * family (gpt-6) counts without being listed; a wrong guess is corrected by
 * the provider's refusal.
 */
export function isOpenAIReasoningModel(model: string): boolean {
  return !/^(gpt-4|gpt-3\.5|chatgpt-)/.test(model) && !/-chat\b/.test(model)
}

/** Whether `model` on `providerId` reasons over the Responses API (false for every other transport). */
export function reasonsOverResponses(providerId: string, model: string): boolean {
  if (!isProvider(providerId)) return false
  const provider = PROVIDERS[providerId]
  return provider.transport === 'responses' && !!provider.responses?.reasons(model)
}

/**
 * What a Chat Completions request for `model` sends beyond the messages
 * (#1271): the provider's reasoning effort for that model (none for a model
 * that doesn't reason), and the completion-token limit with room for the
 * reasoning when it does.
 */
export function chatCompletionsTuning(
  provider: ProviderInfo,
  model: string,
  maxTokens?: number
): { reasoningEffort?: string; maxTokens?: number } {
  const reasoningEffort = provider.chatCompletions?.reasoningEffortFor?.(model)
  const headroom = reasoningEffort && reasoningEffort !== 'none' ? provider.chatCompletions?.reasoningHeadroom ?? 0 : 0
  return {
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(maxTokens ? { maxTokens: maxTokens + headroom } : {}),
  }
}

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
