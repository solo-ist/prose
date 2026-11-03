import { describe, it, expect } from 'vitest'
import { parseMarkdown, serializeMarkdown } from './markdown'

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
