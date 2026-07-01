/**
 * Integration tests for reMarkable typed-text content assembly
 * (`processNotebookContent` in `src/main/remarkable/sync.ts`).
 *
 * Like electron.remarkable-parser.spec.ts, this is a PURE-NODE test (the
 * `electron.` prefix only satisfies playwright.config's testMatch glob). It
 * builds temporary notebook directories from the committed `.rm` fixtures and
 * exercises the per-page merge/assembly path directly.
 *
 * The API key is passed as `null`, which forces `ocrAvailable` false regardless
 * of REMARKABLE_OCR_URL in the environment — so these tests never hit the OCR
 * network path and are deterministic in CI.
 */
import { test, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { processNotebookContent } from '../src/main/remarkable/sync'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, 'fixtures/remarkable')

/** Build a temp notebook dir (`.content` + page `.rm` files) from fixtures, in order. */
function makeNotebook(pages: Array<{ id: string; fixture: string }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rm-nb-'))
  mkdirSync(dir, { recursive: true })
  const content = { formatVersion: 1, cPages: { pages: pages.map((p) => ({ id: p.id })) } }
  writeFileSync(join(dir, 'doc.content'), JSON.stringify(content))
  for (const p of pages) copyFileSync(join(FIXTURES, `${p.fixture}`), join(dir, `${p.id}.rm`))
  return dir
}

test('assembles a mixed notebook: typed pages + handwriting page (OCR unavailable)', async () => {
  const dir = makeNotebook([
    { id: 'aaa', fixture: 'Bold_Heading_Bullet_Normal.rm' },
    { id: 'bbb', fixture: 'Normal_AB.rm' },
    { id: 'ccc', fixture: 'Lines_v2.rm' } // handwriting — blank here since OCR is off
  ])
  const r = await processNotebookContent(dir, 'Mixed Doc', null)
  expect(r.markdown).not.toBeNull()
  if (r.markdown === null) return
  expect(r.extraction).toBe('mixed')
  // Typed content from pages 1 and 2 is present and correctly styled.
  expect(r.markdown).toContain('# new line')
  expect(r.markdown).toContain('- B is a letter of the alphabet')
  expect(r.markdown).toContain('AB')
  // Page order is preserved (page 1 before page 2).
  expect(r.markdown.indexOf('new line')).toBeLessThan(r.markdown.indexOf('AB'))
  // Multi-page assembly adds page separators and a frontmatter header.
  expect(r.markdown).toContain('<!-- Page 1 -->')
  expect(r.markdown).toContain('<!-- Page 3 -->')
  expect(r.markdown).toMatch(/extraction: mixed/)
  expect(r.markdown).toMatch(/pages: 3/)
})

test('classifies a pure typed notebook as typed-text (no OCR needed)', async () => {
  const dir = makeNotebook([{ id: 'x', fixture: 'Normal_AB.rm' }])
  const r = await processNotebookContent(dir, 'Typed Only', null)
  expect(r.markdown).not.toBeNull()
  if (r.markdown === null) return
  expect(r.extraction).toBe('typed-text')
  expect(r.markdown).toContain('AB')
  // A single page gets no page-separator comment.
  expect(r.markdown).not.toContain('<!-- Page 1 -->')
})

test('pure handwriting with OCR unavailable is a graceful skip that records its outcome', async () => {
  const dir = makeNotebook([{ id: 'h', fixture: 'Lines_v2.rm' }])
  const r = await processNotebookContent(dir, 'Handwriting Only', null)
  // No content, but NOT a failure — so no retry sentinel / red triangle.
  expect(r.markdown).toBeNull()
  if (r.markdown === null) {
    expect(r.isFailure).toBe(false)
    // The classification is carried even on a skip so the caller can persist it
    // and avoid re-parsing this notebook on every sync (the re-processing-loop fix).
    expect(r.extraction).toBe('ocr')
  }
})
