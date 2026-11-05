import { describe, expect, it } from 'vitest'
import { resolveStep, sequenceFor, summaryRows } from './steps'

describe('onboarding sequence (#1188)', () => {
  it('shows six steps on a direct build before the AI choice and with AI on', () => {
    expect(sequenceFor({ ai: null, direct: true, defaultAlready: false })).toEqual([
      'welcome', 'ai', 'key', 'claude', 'default', 'done'
    ])
    expect(sequenceFor({ ai: 'ai', direct: true, defaultAlready: false })).toHaveLength(6)
  })

  it('drops the key step when AI is declined and the Claude step on the App Store build', () => {
    expect(sequenceFor({ ai: 'none', direct: true, defaultAlready: false })).toEqual([
      'welcome', 'ai', 'claude', 'default', 'done'
    ])
    expect(sequenceFor({ ai: 'none', direct: false, defaultAlready: false })).toEqual([
      'welcome', 'ai', 'default', 'done'
    ])
  })

  it('skips the default-editor step when Prose is already the default', () => {
    expect(sequenceFor({ ai: 'ai', direct: true, defaultAlready: true })).toEqual([
      'welcome', 'ai', 'key', 'claude', 'done'
    ])
  })

  it('moves a step that fell out of the sequence to the next one that applies', () => {
    const direct = sequenceFor({ ai: 'none', direct: true, defaultAlready: false })
    expect(resolveStep(direct, 'key')).toBe('claude')
    const appStore = sequenceFor({ ai: 'none', direct: false, defaultAlready: false })
    expect(resolveStep(appStore, 'key')).toBe('default')
    expect(resolveStep(appStore, 'claude')).toBe('default')
    expect(resolveStep(appStore, 'done')).toBe('done')
  })
})

describe('onboarding summary (#1188)', () => {
  const base = { ai: 'ai' as const, keySaved: false, crash: false, direct: true, skill: 'idle' as const, mcp: 'idle' as const, def: null, defaultAlready: false }

  it('lists AI, crash reports, both Claude rows and the default on a direct build', () => {
    expect(summaryRows(base).map((r) => r.label)).toEqual([
      'AI assistance', 'Crash reports', 'Claude Skill', 'Claude Desktop', 'Default for .md'
    ])
  })

  it('reflects the choices and side effects', () => {
    const rows = summaryRows({ ...base, keySaved: true, crash: true, skill: 'done', def: 'done' })
    expect(rows[0]).toEqual({ label: 'AI assistance', value: 'On · key in Keychain', tone: 'accept' })
    expect(rows[1]).toEqual({ label: 'Crash reports', value: 'On', tone: 'foreground' })
    expect(rows[2]).toEqual({ label: 'Claude Skill', value: 'Downloaded', tone: 'accept' })
    expect(rows[3]).toEqual({ label: 'Claude Desktop', value: 'Skipped', tone: 'muted' })
    expect(rows[4]).toEqual({ label: 'Default for .md', value: 'Set in Finder', tone: 'foreground' })
  })

  it('has four rows on the App Store build with AI declined', () => {
    const rows = summaryRows({ ...base, ai: 'none', direct: false })
    expect(rows.map((r) => r.value)).toEqual(['Off', 'Off', 'Ask again next launch'])
    expect(rows[0].tone).toBe('muted')
  })

  it('names an already-default handler', () => {
    expect(summaryRows({ ...base, defaultAlready: true }).at(-1)).toEqual({
      label: 'Default for .md', value: 'Already Prose', tone: 'foreground'
    })
  })
})
