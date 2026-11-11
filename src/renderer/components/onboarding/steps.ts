/**
 * The onboarding flow's step logic (#1188), kept pure so it is unit-tested:
 * which steps apply, where a step lands when the sequence changes under it,
 * and the summary the Done step shows. The dialog owns the state; this owns
 * the rules.
 */

export type StepId = 'welcome' | 'ai' | 'key' | 'claude' | 'default' | 'done'
/** The AI choice; null until the user picks a card. */
export type AiChoice = 'ai' | 'none' | null
export type SideEffect = 'idle' | 'working' | 'done' | 'error'
export type DefaultChoice = 'done' | 'later' | null

export const STEP_ORDER: readonly StepId[] = ['welcome', 'ai', 'key', 'claude', 'default', 'done']

export const STEP_LABELS: Record<StepId, string> = {
  welcome: 'Welcome',
  ai: 'AI and privacy',
  key: 'API keys',
  claude: 'Claude',
  default: 'Default editor',
  done: 'Done'
}

export interface SequenceInput {
  ai: AiChoice
  /** A direct (non App Store) build: the Connect Claude step applies. */
  direct: boolean
  /** Prose is already the `.md` default: the Default editor step is skipped. */
  defaultAlready: boolean
}

/**
 * The steps that apply, in order. The key step stays in the count until AI is
 * declined, so Welcome shows the full count ("1 / 6") before the choice.
 */
export function sequenceFor({ ai, direct, defaultAlready }: SequenceInput): StepId[] {
  const seq: StepId[] = ['welcome', 'ai']
  if (ai !== 'none') seq.push('key')
  if (direct) seq.push('claude')
  if (!defaultAlready) seq.push('default')
  seq.push('done')
  return seq
}

/** `step` when the sequence holds it, else the next step in order that does. */
export function resolveStep(seq: readonly StepId[], step: StepId): StepId {
  if (seq.includes(step)) return step
  const from = STEP_ORDER.indexOf(step)
  return seq.find((s) => STEP_ORDER.indexOf(s) > from) ?? 'done'
}

export interface SummaryInput {
  ai: AiChoice
  /** The providers with a key in the Keychain (their labels), named in the summary (#1287). */
  keys: string[]
  crash: boolean
  direct: boolean
  skill: SideEffect
  mcp: SideEffect
  def: DefaultChoice
  defaultAlready: boolean
}

export interface SummaryRow {
  label: string
  value: string
  tone: 'foreground' | 'muted' | 'accept'
}

/** "Anthropic", "Anthropic and OpenAI", "A, B and C". */
function listLabels(labels: string[]): string {
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0]
}

export function summaryRows(i: SummaryInput): SummaryRow[] {
  const rows: SummaryRow[] = []
  if (i.ai === 'none') rows.push({ label: 'AI assistance', value: 'Off', tone: 'muted' })
  else if (i.keys.length > 0) rows.push({ label: 'AI assistance', value: `On · ${listLabels(i.keys)} ${i.keys.length > 1 ? 'keys' : 'key'} in Keychain`, tone: 'accept' })
  else rows.push({ label: 'AI assistance', value: 'On · add a key in Settings', tone: 'foreground' })
  rows.push({ label: 'Crash reports', value: i.crash ? 'On' : 'Off', tone: i.crash ? 'foreground' : 'muted' })
  if (i.direct) {
    rows.push({
      label: 'Claude Skill',
      value: i.skill === 'done' ? 'Downloaded' : 'Skipped',
      tone: i.skill === 'done' ? 'accept' : 'muted'
    })
    rows.push({
      label: 'Claude Desktop',
      value: i.mcp === 'done' ? 'Installed' : 'Skipped',
      tone: i.mcp === 'done' ? 'accept' : 'muted'
    })
  }
  if (i.defaultAlready) rows.push({ label: 'Default for .md', value: 'Already Prose', tone: 'foreground' })
  else if (i.def === 'done') rows.push({ label: 'Default for .md', value: 'Set in Finder', tone: 'foreground' })
  else rows.push({ label: 'Default for .md', value: 'Ask again next launch', tone: 'muted' })
  return rows
}
