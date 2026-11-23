/**
 * One naming scheme for every provider's models (#1322).
 *
 * A model has two names, both derived from its id: a **short** one for the
 * status bar ("Sonnet 5.5", "Luna 5.6", "Apertus 70b") and a **long** one for
 * menus, which adds who makes or runs it ("Claude Sonnet 5.5", "OpenAI Luna
 * 5.6", "Regolo Apertus 70b"). Deriving them here, rather than taking each
 * provider's display name, keeps a model that ships after this build named
 * the same way as its siblings.
 */

export interface ModelNames {
  /** For the status bar: the model and its version. */
  short: string
  /** For menus: the short name after its maker (Claude, OpenAI) or its host (Regolo, Tinfoil, GreenPT). */
  long: string
}

/** The co-op's hosts, as they are written. */
const COOP_HOSTS: Record<string, string> = {
  greenpt: 'GreenPT',
  tinfoil: 'Tinfoil',
  regolo: 'Regolo',
}

/**
 * Co-op models whose short name the id alone doesn't give: the version is run
 * into the family ("qwen3.5"), or the id carries a detail the name leaves out
 * (DeepSeek's "flash" is its only build on the gateway).
 */
const COOP_NAMES: Record<string, string> = {
  'deepseek-v4.1-flash': 'DeepSeek 4.1',
  'deepseek-v4-1-flash': 'DeepSeek 4.1',
  'glm-5.3': 'GLM 5.3',
  'glm-5.3-flash': 'GLM 5.3 Flash',
  'apertus-70b': 'Apertus 70b',
  'qwen3.5-122b': 'Qwen 3.5 122b',
  'gemma4-31b': 'Gemma 4 31b',
  'mistral-small-4-119b': 'Mistral Small 4 119b',
  'gpt-oss-120b': 'GPT-OSS 120b',
}

/** Words written in capitals when an id is spelled out. */
const UPPERCASE = new Set(['gpt', 'glm', 'oss', 'tee'])

/** "mistral-small-4-119b" → "Mistral Small 4 119b": the fallback for an id no rule knows. */
function spellOut(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => {
      if (UPPERCASE.has(word)) return word.toUpperCase()
      // A size or a version ("70b", "4.1") stays as written.
      if (/^\d/.test(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

/** `claude-sonnet-5-5`, `claude-fable-5`, `claude-haiku-4-5-20251001` → "Sonnet 5.5", "Fable 5", "Haiku 4.5". */
function anthropicShort(id: string): string | null {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id)
  if (!match) return null
  const [, family, major, minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

/**
 * `gpt-5.5` → "GPT 5.5"; `gpt-5.6-luna` → "Luna 5.6"; `gpt-6-astra` → "Astra 6".
 * A size (`gpt-5-mini`) is not a line of its own: "GPT 5 Mini".
 */
function openaiShort(id: string): string | null {
  // A dated snapshot reads like its base.
  const match = /^gpt-(\d+(?:\.\d+)?)(?:-([a-z]+))?$/.exec(id.replace(/-\d{4}-\d{2}-\d{2}$/, ''))
  if (!match) return null
  const [, version, variant] = match
  if (!variant) return `GPT ${version}`
  const name = variant.charAt(0).toUpperCase() + variant.slice(1)
  return /^(mini|nano|pro)$/.test(variant) ? `GPT ${version} ${name}` : `${name} ${version}`
}

/**
 * The names of `id` on `provider`. `fallback` is the provider's own display
 * name, used when the id fits no rule (an older Claude id, a custom model).
 */
export function modelNames(provider: string, id: string, fallback?: string): ModelNames {
  if (provider === 'anthropic') {
    const short = anthropicShort(id)
    if (short) return { short, long: `Claude ${short}` }
    const name = fallback && fallback !== id ? fallback : id
    return { short: name.replace(/^Claude\s+/, ''), long: name }
  }
  if (provider === 'openai') {
    const short = openaiShort(id)
    if (short) return { short, long: `OpenAI ${short}` }
    return { short: id, long: id }
  }
  if (provider === 'inference-coop') {
    const slash = id.indexOf('/')
    // An alias the gateway lists without a host ("glm-tee") has only one name.
    if (slash < 0) {
      const name = spellOut(id)
      return { short: name, long: name }
    }
    const host = id.slice(0, slash)
    const model = id.slice(slash + 1)
    const short = COOP_NAMES[model] ?? spellOut(model)
    return { short, long: `${COOP_HOSTS[host] ?? spellOut(host)} ${short}` }
  }
  const name = fallback || id
  return { short: name, long: name }
}
