import { describe, expect, it } from 'vitest'
import { releaseNotesIds } from './notesId'

describe('release notes ids by build (#1222)', () => {
  it('reads only the shared file on the direct build', () => {
    expect(releaseNotesIds('1.9.0', false)).toEqual(['1.9.0'])
  })

  it('reads the App Store edition first and falls back to the shared file', () => {
    expect(releaseNotesIds('1.9.0', true)).toEqual(['1.9.0-mas', '1.9.0'])
  })

  it('produces ids the main-process reader accepts', () => {
    // The same check `src/main/releaseNotes.ts` applies before building a path.
    const accepted = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/
    for (const id of releaseNotesIds('1.9.0', true)) expect(id).toMatch(accepted)
  })
})
