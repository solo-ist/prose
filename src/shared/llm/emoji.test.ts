import { describe, expect, it } from 'vitest'
import { firstEmoji } from './emoji'

describe('firstEmoji', () => {
  it('returns the emoji a model answered with', () => {
    expect(firstEmoji('📝')).toBe('📝')
    expect(firstEmoji(' 🌊\n')).toBe('🌊')
  })

  it('finds the emoji in a wordier reply', () => {
    expect(firstEmoji('Sure! 🚀 fits this document.')).toBe('🚀')
    expect(firstEmoji('🌱 or 🌳')).toBe('🌱')
  })

  it('returns null when the reply has none', () => {
    expect(firstEmoji('')).toBeNull()
    expect(firstEmoji('A document about 3 rivers.')).toBeNull()
  })
})
