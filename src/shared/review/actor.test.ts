import { describe, expect, it } from 'vitest'
import {
  SELF,
  actorAvatarKind,
  actorLabel,
  actorOfComment,
  actorOfProvenance,
  cleanActorText,
  isAgentActor,
  shortModelName,
  type Actor,
} from './actor'

describe('actorOfComment: records from before 1.9.1 (design §4)', () => {
  it("reads a 'user' row with no authorName as the writer", () => {
    expect(actorOfComment({ author: 'user' })).toEqual(SELF)
  })
  it('reads a row with no author at all as the writer', () => {
    expect(actorOfComment({})).toEqual(SELF)
  })
  it('reads a share reviewer by authorName', () => {
    expect(actorOfComment({ author: 'user', authorName: 'Dana' })).toEqual({ kind: 'human', self: false, name: 'Dana' })
  })
  it("reads an 'ai' row as unattributed AI (the in-app chat and MCP both wrote 'ai')", () => {
    expect(actorOfComment({ author: 'ai' })).toEqual({ kind: 'unattributed', label: 'AI' })
  })
  it("prefers 'ai' over a stray authorName", () => {
    expect(actorOfComment({ author: 'ai', authorName: 'Prose' })).toEqual({ kind: 'unattributed', label: 'AI' })
  })
  it('keeps a stamped actor as it is', () => {
    const actor: Actor = { kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'Codex laptop', client: 'codex' }
    expect(actorOfComment({ author: 'ai', actor })).toBe(actor)
  })
  it('cleans a reviewer name on the way in', () => {
    expect(actorOfComment({ authorName: '  Da\u0000na\n ' })).toEqual({ kind: 'human', self: false, name: 'Dana' })
  })
})

describe('actorOfProvenance: annotations and suggestions from before 1.9.1', () => {
  it('reads Claude (MCP) as the legacy MCP connection', () => {
    expect(actorOfProvenance('Claude (MCP)')).toEqual({ kind: 'mcp-agent', connectionId: 'legacy', connectionLabel: 'MCP client' })
  })
  it('reads Imported and External AI as unattributed', () => {
    expect(actorOfProvenance('Imported')).toEqual({ kind: 'unattributed', label: 'Imported' })
    expect(actorOfProvenance('External AI')).toEqual({ kind: 'unattributed', label: 'External AI' })
  })
  it('reads any other model as an Anthropic Prose Agent (the in-app chat was Anthropic-only)', () => {
    expect(actorOfProvenance('claude-sonnet-5-5')).toEqual({ kind: 'prose-agent', provider: 'anthropic', model: 'claude-sonnet-5-5' })
  })
  it('reads a missing or blank model as unattributed AI', () => {
    expect(actorOfProvenance(undefined)).toEqual({ kind: 'unattributed', label: 'AI' })
    expect(actorOfProvenance('  ')).toEqual({ kind: 'unattributed', label: 'AI' })
  })
  it('keeps a stamped actor whatever the model says', () => {
    const actor: Actor = { kind: 'prose-agent', provider: 'openai', model: 'gpt-5.1' }
    expect(actorOfProvenance('Claude (MCP)', actor)).toBe(actor)
  })
})

describe('actorLabel', () => {
  it('names the writer from Settings, "You" when unset, "the writer" for tool results', () => {
    expect(actorLabel(SELF, { selfName: 'Angel' })).toBe('Angel')
    expect(actorLabel(SELF, { selfName: '' })).toBe('You')
    expect(actorLabel(SELF)).toBe('You')
    expect(actorLabel(SELF, { selfName: null })).toBe('the writer')
  })
  it('names a reviewer, falling back to "Reviewer"', () => {
    expect(actorLabel({ kind: 'human', self: false, name: 'Dana' })).toBe('Dana')
    expect(actorLabel({ kind: 'human', self: false })).toBe('Reviewer')
  })
  it('names a Prose Agent by its model', () => {
    expect(actorLabel({ kind: 'prose-agent', provider: 'anthropic', model: 'claude-sonnet-5-5' })).toBe('Prose · Sonnet 5.5')
    expect(actorLabel({ kind: 'prose-agent', provider: 'openai', model: 'gpt-5-mini' })).toBe('Prose · GPT-5 mini')
    expect(actorLabel({ kind: 'prose-agent', provider: 'inference-coop', model: 'tinfoil/glm-5.3' })).toBe('Prose · tinfoil/glm-5.3')
    expect(actorLabel({ kind: 'prose-agent', provider: 'openai', model: '' })).toBe('Prose · OpenAI')
  })
  it('names an MCP agent by its connection, with the self-reported client beside it', () => {
    expect(actorLabel({ kind: 'mcp-agent', connectionId: 'c', connectionLabel: 'Codex laptop', client: 'Claude' })).toBe('Codex laptop · Claude')
    expect(actorLabel({ kind: 'mcp-agent', connectionId: 'c', connectionLabel: 'Codex laptop', client: 'Codex laptop' })).toBe('Codex laptop')
    expect(actorLabel({ kind: 'mcp-agent', connectionId: 'launch', connectionLabel: '' })).toBe('MCP client')
    // A known client reads by the name a writer knows it by, once (#1298); records that hold the raw report too.
    expect(actorLabel({ kind: 'mcp-agent', connectionId: 'launch', connectionLabel: 'local-agent-mode-Prose', client: 'local-agent-mode-Prose' })).toBe('Claude Desktop')
    expect(actorLabel({ kind: 'mcp-agent', connectionId: 'launch', connectionLabel: 'Claude Desktop', client: 'claude-ai' })).toBe('Claude Desktop')
    expect(actorLabel({ kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'Laptop', client: 'claude-code' })).toBe('Laptop · Claude Code')
    // A named connection's label is the writer's own words, shown as written.
    expect(actorLabel({ kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'claude-ai' })).toBe('claude-ai')
  })
  it('names unattributed text by its label', () => {
    expect(actorLabel({ kind: 'unattributed', label: 'Imported' })).toBe('Imported')
  })
  it('never lets a self-reported client name carry control characters or run long', () => {
    const label = actorLabel({ kind: 'mcp-agent', connectionId: 'c', connectionLabel: 'Laptop', client: `x\u0007${'y'.repeat(300)}` })
    expect(label).not.toMatch(/[\u0000-\u001f]/)
    expect(label.length).toBeLessThanOrEqual('Laptop · '.length + 100)
  })
})

describe('helpers', () => {
  it('cleanActorText trims, strips control characters and caps at 100', () => {
    expect(cleanActorText('  a\u0000b\u001fc  ')).toBe('abc')
    expect(cleanActorText('z'.repeat(150))).toHaveLength(100)
    expect(cleanActorText(undefined)).toBe('')
  })
  it('shortModelName compacts Claude and OpenAI GPT ids and leaves others as given', () => {
    expect(shortModelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(shortModelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(shortModelName('gpt-5.1')).toBe('GPT-5.1')
    expect(shortModelName('gpt-5-mini')).toBe('GPT-5 mini')
    expect(shortModelName('gpt-5-mini-2025-08-07')).toBe('GPT-5 mini')
    expect(shortModelName('gpt-4o-mini')).toBe('GPT-4o mini')
    expect(shortModelName('o4-mini')).toBe('o4-mini')
    expect(shortModelName('tinfoil/glm-5.3')).toBe('tinfoil/glm-5.3')
  })
  it('people are not agents; everything else is', () => {
    expect(isAgentActor(SELF)).toBe(false)
    expect(isAgentActor({ kind: 'human', self: false, name: 'Dana' })).toBe(false)
    expect(isAgentActor({ kind: 'unattributed', label: 'AI' })).toBe(true)
    expect(actorAvatarKind({ kind: 'prose-agent', provider: 'anthropic', model: 'm' })).toBe('ai')
    expect(actorAvatarKind(SELF)).toBe('user')
  })
})
