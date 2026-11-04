import { describe, it, expect } from 'vitest'
import { loadFrontmatterYaml, parseMarkdown, serializeMarkdown } from './markdown'

describe('parseMarkdown / serializeMarkdown (#1105, #1151)', () => {
  it('keeps the body bytes after the closing fence, so an untouched document round-trips byte for byte', () => {
    const doc = '---\ntitle: X\n---\n\n# Title\n\nBody.\n'
    const parsed = parseMarkdown(doc)
    expect(parsed.frontmatter).toEqual({ title: 'X' })
    expect(parsed.content).toBe('\n# Title\n\nBody.\n')
    expect(serializeMarkdown(parsed.content, parsed.frontmatter)).toBe(doc)
  })

  it('returns a document without frontmatter untouched', () => {
    const doc = '# Title\n\nBody.\n'
    expect(parseMarkdown(doc)).toEqual({ content: doc, frontmatter: {} })
    expect(serializeMarkdown(doc, {})).toBe(doc)
  })
})

describe('frontmatter YAML keeps dates as the text they were written as (#862)', () => {
  it('round-trips a bare date and a timestamp byte for byte', () => {
    const doc = '---\ntitle: X\ndate: 2026-09-04\ngoogle_synced_at: 2026-05-02T00:00:00.000Z\n---\n\nBody.\n'
    const parsed = parseMarkdown(doc)
    expect(parsed.frontmatter).toEqual({
      title: 'X',
      date: '2026-09-04',
      google_synced_at: '2026-05-02T00:00:00.000Z'
    })
    expect(serializeMarkdown(parsed.content, parsed.frontmatter)).toBe(doc)
  })

  it('writes a date string bare, not quoted, so the panel can edit it and the file stays stable', () => {
    expect(serializeMarkdown('Body.\n', { date: '2026-09-04' })).toBe('---\ndate: 2026-09-04\n---\nBody.\n')
  })

  it('parses a model-written YAML payload with the same schema', () => {
    expect(loadFrontmatterYaml('date: 2026-11-04\ntags: [a, b]')).toEqual({ date: '2026-11-04', tags: ['a', 'b'] })
  })

  it('still reads the other YAML types frontmatter uses', () => {
    expect(parseMarkdown('---\nn: 3\nflag: true\nempty:\nlist:\n  - a\n---\n').frontmatter).toEqual({
      n: 3,
      flag: true,
      empty: null,
      list: ['a']
    })
  })
})
