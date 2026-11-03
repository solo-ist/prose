/**
 * buildWordDiffAnnotations (#1146): the records an AI edit or an accepted
 * suggestion adds over the replaced range, and how a prior annotation on
 * that range is carried over onto its unchanged words.
 */

import { describe, it, expect } from 'vitest'
import { buildWordDiffAnnotations } from './diffUtils'
import type { AIAnnotation } from '../types/annotations'

const PROV = { model: 'Opus', conversationId: 'c', messageId: 'm' }

function prior(originalText: string, needle: string, rangeFrom: number, extra: Partial<AIAnnotation> = {}): AIAnnotation {
  const i = originalText.indexOf(needle)
  if (i === -1) throw new Error(`"${needle}" not in "${originalText}"`)
  return {
    id: 'prior-1',
    documentId: 'doc',
    type: 'replacement',
    createdAt: 1_000,
    from: rangeFrom + i,
    to: rangeFrom + i + needle.length,
    content: needle,
    provenance: { model: 'Earlier', conversationId: 'c0', messageId: 'm0' },
    explanation: 'the first edit',
    ...extra
  }
}

describe('buildWordDiffAnnotations', () => {
  it('annotates the changed run and carries a prior over as one record on its surviving words', () => {
    const rangeFrom = 10
    const originalText = 'She is polite as a neighbor’s, and quiet.'
    const newText = 'She is polite as a neighbor’s, and silent.'
    const p = prior(originalText, 'polite as a neighbor’s,', rangeFrom)
    const out = buildWordDiffAnnotations({ originalText, newText, rangeFrom, rangeTo: rangeFrom + newText.length, provenance: PROV, priorAnnotations: [p] })

    const carried = out.filter((r) => r.id === p.id)
    expect(carried).toHaveLength(1)
    expect(carried[0]).toMatchObject({ createdAt: p.createdAt, provenance: p.provenance, explanation: p.explanation, type: p.type })
    expect(newText.slice(carried[0].from - rangeFrom, carried[0].to - rangeFrom)).toBe('polite as a neighbor’s,')
    expect(carried[0].content).toBe('polite as a neighbor’s,')

    const fresh = out.filter((r) => r.id !== p.id)
    expect(fresh).toHaveLength(1)
    expect(fresh[0].provenance).toEqual(PROV)
    expect(newText.slice(fresh[0].from - rangeFrom, fresh[0].to - rangeFrom)).toBe('silent.')
  })

  it('splits a prior into runs around a changed word inside it; only the first keeps its id', () => {
    const rangeFrom = 0
    const originalText = 'polite as a neighbor, and quiet'
    const newText = 'polite as an acquaintance, and quiet'
    const p = prior(originalText, 'polite as a neighbor, and quiet', rangeFrom)
    const out = buildWordDiffAnnotations({ originalText, newText, rangeFrom, rangeTo: newText.length, provenance: PROV, priorAnnotations: [p] })
    const carried = out.filter((r) => r.provenance === p.provenance)
    expect(carried.map((r) => r.content)).toEqual(['polite as', 'and quiet'])
    expect(carried[0].id).toBe(p.id)
    expect(carried[1].id).toBeUndefined()
    expect(carried.every((r) => r.createdAt === p.createdAt)).toBe(true)
  })

  it('ignores detached priors and priors outside the unchanged words', () => {
    const originalText = 'one two three'
    const newText = 'one 2 three'
    const detached = prior(originalText, 'one', 0, { detached: true })
    const gone = prior(originalText, 'two', 0, { id: 'prior-2' })
    const out = buildWordDiffAnnotations({ originalText, newText, rangeFrom: 0, rangeTo: newText.length, provenance: PROV, priorAnnotations: [detached, gone] })
    expect(out.filter((r) => r.id)).toEqual([])
    expect(out.map((r) => r.content)).toEqual(['2'])
  })
})
