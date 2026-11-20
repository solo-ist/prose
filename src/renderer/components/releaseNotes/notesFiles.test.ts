import { readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { MAS_NOTES_SUFFIX } from './notesId'

/**
 * The bundled release notes, checked by edition (#1222). The App Store build reads
 * `<version>-mas.md` first and falls back to `<version>.md`, so:
 *
 * - a shared notes file that names a surface the App Store build lacks must have an App
 *   Store sibling, or App Store users would read about features they cannot reach;
 * - an App Store file must name none of them.
 *
 * The pattern lists what the App Store build gates off: sharing and its sign-in, the
 * Claude Desktop integration (MCP, the skill), reMarkable sync and the auto-updater. It
 * also refuses any mention of another edition of the app.
 */
const DIRECT_ONLY =
  /\b(shar(e|ed|es|ing)|sign(ed)?[- ]in|claude desktop|mcp|remarkable|auto-?updat(e|es|ing)|update available|direct[- ]download)\b/i

const dir = resolve(process.cwd(), 'resources/release-notes')
const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
const masFiles = files.filter((f) => f.endsWith(`${MAS_NOTES_SUFFIX}.md`))
const sharedFiles = files.filter((f) => !masFiles.includes(f))

function directOnlyHits(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => DIRECT_ONLY.test(line))
    .map((line) => line.trim())
}

describe('release notes editions (#1222)', () => {
  it('finds the bundled notes', () => {
    expect(sharedFiles.length).toBeGreaterThan(0)
  })

  for (const file of sharedFiles) {
    it(`${file}: an App Store edition exists when it names a direct-only surface`, () => {
      const hits = directOnlyHits(readFileSync(join(dir, file), 'utf8'))
      if (hits.length === 0) return
      const sibling = file.replace(/\.md$/, `${MAS_NOTES_SUFFIX}.md`)
      expect(files, `${file} names ${hits.length} direct-only line(s), e.g. "${hits[0]}"`).toContain(sibling)
    })
  }

  for (const file of masFiles) {
    it(`${file}: names no direct-only surface`, () => {
      expect(directOnlyHits(readFileSync(join(dir, file), 'utf8'))).toEqual([])
    })

    it(`${file}: has a shared edition beside it`, () => {
      expect(files).toContain(file.replace(`${MAS_NOTES_SUFFIX}.md`, '.md'))
    })
  }
})
