/**
 * Who made a record (#1232; design: docs/architecture/review-provenance.md).
 *
 * Every comment thread, reply, AI suggestion and AI annotation can carry an
 * `Actor`. Records written before 1.9.1 have none; `actorOf…` derives one from
 * their legacy fields whenever it is read, and nothing is ever written back.
 * Shared by main (MCP connections, the relay) and the renderer.
 */

export type ProseAgentProvider = 'anthropic' | 'openai' | 'inference-coop'

export interface HumanActor {
  kind: 'human'
  /** This desktop's writer. Their name comes from Settings at display time; records never hold it. */
  self: boolean
  /** A share reviewer's display name (only when `self` is false). */
  name?: string
  /** Reserved for ATProto (AT-1). Nothing sets it in 1.9.1. */
  did?: string
}

export interface ProseAgentActor {
  kind: 'prose-agent'
  provider: ProseAgentProvider
  model: string
}

export interface McpAgentActor {
  kind: 'mcp-agent'
  /** The connection the writer created (M2), 'launch' for the bundled stdio bridge, or 'legacy'. */
  connectionId: string
  /** The connection's label when the record was made. */
  connectionLabel: string
  /** Self-reported by the client. Untrusted: shown beside the label, never instead of it. */
  client?: string
  clientVersion?: string
  model?: string
  /** How the call arrived. Filled in by main from M2 (#1236) on. */
  via?: 'stdio' | 'http' | 'relay'
}

/**
 * AI text whose origin is unknown: rows from before 1.9.1, pasted AI text and
 * text the writer marks as AI-written. `label` is only ever one of the code
 * constants below, never input from a client, a share row or a file.
 */
export interface UnattributedActor {
  kind: 'unattributed'
  label: UnattributedLabel
}

export type UnattributedLabel = 'AI' | 'Imported' | 'External AI'

export type Actor = HumanActor | ProseAgentActor | McpAgentActor | UnattributedActor

export const SELF: HumanActor = { kind: 'human', self: true }

const MAX_ACTOR_TEXT = 100

/** Trim, drop control characters and cap a self-reported string (a client name, a model, a reviewer's name). */
export function cleanActorText(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, MAX_ACTOR_TEXT)
}

export function isAgentActor(actor: Actor): boolean {
  return actor.kind !== 'human'
}

/** A comment thread or reply: its `actor`, else derived from `author` / `authorName`. */
export function actorOfComment(record: { actor?: Actor; author?: 'user' | 'ai'; authorName?: string }): Actor {
  if (record.actor) return record.actor
  if (record.author === 'ai') return { kind: 'unattributed', label: 'AI' }
  if (record.authorName) return { kind: 'human', self: false, name: cleanActorText(record.authorName) }
  return SELF
}

/** An AI annotation or suggestion: its `actor`, else derived from the provenance model it was stamped with. */
export function actorOfProvenance(model: string | null | undefined, actor?: Actor | null): Actor {
  if (actor) return actor
  const m = (model ?? '').trim()
  if (!m) return { kind: 'unattributed', label: 'AI' }
  if (m === 'Claude (MCP)') return { kind: 'mcp-agent', connectionId: 'legacy', connectionLabel: 'MCP client' }
  if (m === 'Imported') return { kind: 'unattributed', label: 'Imported' }
  if (m === 'External AI') return { kind: 'unattributed', label: 'External AI' }
  // Before 1.9.1 the in-app chat was Anthropic-only.
  return { kind: 'prose-agent', provider: 'anthropic', model: m }
}

const PROVIDER_NAMES: Record<ProseAgentProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'inference-coop': 'Inference Coop',
}

export function providerName(provider: ProseAgentProvider): string {
  return PROVIDER_NAMES[provider] ?? provider
}

/**
 * A compact model name: `claude-sonnet-5-5` → "Sonnet 5.5", `gpt-5-mini` →
 * "GPT-5 mini" (dated suffixes dropped); any other id is shown as given.
 */
export function shortModelName(model: string | null | undefined): string {
  const m = cleanActorText(model)
  if (/^gpt-/i.test(m)) {
    const [version, ...words] = m.slice(4).replace(/-\d{4}-\d{2}-\d{2}$/, '').split('-').filter(Boolean)
    return version ? ['GPT-' + version, ...words].join(' ') : m
  }
  if (!/^claude[-/]/.test(m)) return m
  const tokens = m.replace(/^claude[-/]?/, '').replace(/[-\s]?\d{6,}$/, '').split('-').filter(Boolean)
  if (tokens.length === 0) return m
  const name = tokens[0].charAt(0).toUpperCase() + tokens[0].slice(1)
  const version = tokens.slice(1).join('.')
  return version ? `${name} ${version}` : name
}

/**
 * The name a writer knows a client by, for the `clientInfo.name` it reports.
 * Claude Desktop reports "claude-ai" from a chat and "local-agent-mode-<server
 * name>" from its agent mode, which read as noise on a card. Anything not
 * listed is shown as reported.
 */
const CLIENT_DISPLAY_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/^claude-ai$/i, 'Claude Desktop'],
  [/^local-agent-mode-/i, 'Claude Desktop'],
  [/^claude-code$/i, 'Claude Code'],
  [/^codex-mcp-client$/i, 'Codex'],
]

export function clientDisplayName(reported: unknown): string {
  const name = cleanActorText(reported)
  return CLIENT_DISPLAY_NAMES.find(([pattern]) => pattern.test(name))?.[1] ?? name
}

/**
 * The one display string for an actor. `selfName` is the Settings name (empty
 * → "You"); MCP results pass `selfName: null` to get "the writer".
 */
export function actorLabel(actor: Actor, opts: { selfName?: string | null } = {}): string {
  switch (actor.kind) {
    case 'human':
      if (actor.self) {
        if (opts.selfName === null) return 'the writer'
        return cleanActorText(opts.selfName) || 'You'
      }
      return cleanActorText(actor.name) || 'Reviewer'
    case 'prose-agent':
      return `Prose · ${shortModelName(actor.model) || providerName(actor.provider)}`
    case 'mcp-agent': {
      // The launch connection's label is the client's own report (a named
      // connection's is the writer's, shown as written); records made before
      // the display names existed hold the raw one.
      const raw = cleanActorText(actor.connectionLabel)
      const label = (actor.connectionId === 'launch' ? clientDisplayName(raw) : raw) || 'MCP client'
      const client = clientDisplayName(actor.client)
      return client && client !== label ? `${label} · ${client}` : label
    }
    case 'unattributed':
      return actor.label
  }
}

/** The avatar a surface draws for an actor: the writer and reviewers are people, everything else is AI. */
export function actorAvatarKind(actor: Actor): 'user' | 'ai' {
  return actor.kind === 'human' ? 'user' : 'ai'
}
