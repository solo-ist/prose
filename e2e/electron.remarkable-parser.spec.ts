/**
 * Regression tests for the reMarkable v6 `.rm` typed-text parser
 * (`src/main/remarkable/rm-scene-parser.ts`).
 *
 * NOTE: despite the `electron.` prefix (required to match playwright.config's
 * testMatch glob so it runs in CI), this is a PURE-NODE unit test — it does not
 * launch Electron. The parser is a zero-dependency pure function, so it is
 * imported and exercised directly against committed reMarkable fixtures.
 *
 * Fixtures live in e2e/fixtures/remarkable/ and are vendored from the
 * MIT-licensed rmscene project (see that dir's README). Expected extractions
 * are cross-checked against rmscene's own tests, keeping our TS port in
 * agreement with the reference implementation.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseRmPageForText,
  paragraphsToMarkdown
} from '../src/main/remarkable/rm-scene-parser'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, 'fixtures/remarkable')

function parse(file: string) {
  return parseRmPageForText(readFileSync(join(FIXTURES, file)))
}

test('extracts a single plain paragraph', () => {
  const r = parse('Normal_AB.rm')
  expect(r.hasTypedText).toBe(true)
  expect(r.hasStrokes).toBe(false)
  expect(r.formatVersion).toBe(6)
  expect(r.paragraphs).toEqual([{ text: 'AB', style: 'plain' }])
  expect(paragraphsToMarkdown(r.paragraphs)).toBe('AB')
})

test('maps paragraph styles (bold, heading, bullet, plain) to markdown', () => {
  const r = parse('Bold_Heading_Bullet_Normal.rm')
  expect(r.paragraphs).toEqual([
    { text: 'A', style: 'bold' },
    { text: 'new line', style: 'heading' },
    { text: 'B is a letter of the alphabet', style: 'bullet' },
    { text: 'C', style: 'plain' }
  ])
  expect(paragraphsToMarkdown(r.paragraphs)).toBe(
    '## A\n\n# new line\n\n- B is a letter of the alphabet\n\nC'
  )
})

test('orders concurrent-author CRDT edits deterministically', () => {
  // Two authors inserted between "A" and "Z"; the higher author id sorts first,
  // giving "A12_Z" (not "A_12Z"). Exercises the toposort priority ordering.
  const r = parse('test-crdt-ordering.rm')
  expect(r.paragraphs).toEqual([{ text: 'A12_Z', style: 'heading' }])
})

test('extracts typed text and flags strokes on a mixed page', () => {
  const r = parse('Normal_A_stroke_2_layers_v3.3.2.rm')
  expect(r.hasTypedText).toBe(true)
  expect(r.hasStrokes).toBe(true)
  // Inline bold/italic are not rendered in v1 — text is preserved verbatim.
  expect(r.paragraphs.map((p) => p.text)).toEqual([
    'A',
    'v3.2.2',
    'Normal bold italic',
    'Bold italic normal',
    'Bold line',
    'Normal line',
    'Heading line'
  ])
})

test('reports no typed text for a pure-handwriting page', () => {
  const r = parse('Lines_v2.rm')
  expect(r.hasTypedText).toBe(false)
  expect(r.hasStrokes).toBe(true)
})

test('degrades gracefully on corrupt and empty input (never throws)', () => {
  const corrupt = parseRmPageForText(Buffer.from([1, 2, 3, 4, 5]))
  expect(corrupt.hasTypedText).toBe(false)
  expect(corrupt.hasStrokes).toBe(true) // fallback → caller routes to OCR

  const empty = parseRmPageForText(Buffer.alloc(0))
  expect(empty.hasTypedText).toBe(false)
})
