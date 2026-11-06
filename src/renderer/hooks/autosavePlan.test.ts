import { describe, it, expect } from 'vitest'
import { planAutosave } from './autosavePlan'
import type { Tab } from '../stores/tabStore'

const FM = { title: 'x' }
const tab = (over: Partial<Tab> = {}): Tab => ({
  id: 't1',
  documentId: 'd1',
  path: '/docs/a.md',
  title: 'a',
  isDirty: true,
  content: 'Body.',
  frontmatter: FM,
  ...over
})

describe('planAutosave', () => {
  it('auto: re-arms when a dirty tab with a path had its content or frontmatter replaced', () => {
    const before = [tab()]
    expect(planAutosave(before, [tab({ content: 'Body!' })], 'auto')).toEqual({ arm: ['t1'], clear: [] })
    expect(planAutosave(before, [tab({ frontmatter: { title: 'y' } })], 'auto')).toEqual({ arm: ['t1'], clear: [] })
    // The same record (a cursor cache, say) arms nothing.
    expect(planAutosave(before, [tab({ cursorPosition: { line: 2, column: 1 } })], 'auto')).toEqual({ arm: [], clear: [] })
  })

  it('arms on the clean→dirty transition in both modes, once in custom mode', () => {
    const clean = [tab({ isDirty: false })]
    expect(planAutosave(clean, [tab()], 'auto')).toEqual({ arm: ['t1'], clear: [] })
    expect(planAutosave(clean, [tab()], 'custom')).toEqual({ arm: ['t1'], clear: [] })
    // Custom: further edits while dirty leave the interval alone.
    expect(planAutosave([tab()], [tab({ content: 'More.' })], 'custom')).toEqual({ arm: [], clear: [] })
  })

  it('clears a tab that went clean, lost its path, left the store, or when the mode is off', () => {
    expect(planAutosave([tab()], [tab({ isDirty: false })], 'auto')).toEqual({ arm: [], clear: ['t1'] })
    expect(planAutosave([tab()], [], 'auto')).toEqual({ arm: [], clear: ['t1'] })
    expect(planAutosave([tab()], [tab({ content: 'More.' })], 'off')).toEqual({ arm: [], clear: ['t1'] })
    // A clean tab never held a timer: nothing to clear.
    expect(planAutosave([tab({ isDirty: false })], [tab({ isDirty: false, content: 'x' })], 'auto')).toEqual({ arm: [], clear: [] })
  })

  it('never arms an untitled tab, and a tab that arrived dirty waits for its first edit', () => {
    expect(planAutosave([tab({ path: null })], [tab({ path: null, content: 'More.' })], 'auto')).toEqual({ arm: [], clear: [] })
    expect(planAutosave([], [tab()], 'auto')).toEqual({ arm: [], clear: [] })
    expect(planAutosave([tab()], [tab({ content: 'Edited.' })], 'auto')).toEqual({ arm: ['t1'], clear: [] })
  })
})
