/**
 * An AI annotation stays on its words across a reload that re-parses the
 * document (#1138, #1146).
 *
 * Annotations are positions. A relaunch re-parses the file from disk, and
 * the serializer tidies text: a trailing space left by a deletion is
 * dropped, a run of spaces collapses. Above an annotation that makes the
 * re-parsed document shorter, and the saved positions used to be applied to
 * it unchanged, so the highlight slid by the difference. Each record now
 * carries the text under it, and the annotations plugin puts a range back on
 * the nearest occurrence of that text when the reload has left it elsewhere.
 * A tab switch no longer re-parses (#1145), so the two switch cases are
 * guards; the relaunch is the case that failed.
 *
 * The first version of this spec (#1141) checked only the painted text and
 * missed that its fix wrote one document's records under another's key, so
 * every case also reads the rows under both documents' keys.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  executeProseTool,
  getAnnotations,
  getAnnotationDocId,
  readAnnotationsFromDB,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string
let otherDocId: string

const DOC = '# Probe\n\nIntro paragraph here with words.\n\nSome text to edit.\n\nSecond paragraph.\n'
const env = () => ({ PROSE_USER_DATA_DIR: qaUserDataDir, PROSE_DOCS_DIR: qaDocsDir, PROSE_DEBUG_PORT: '9231' })

/* eslint-disable @typescript-eslint/no-explicit-any */

async function launch(): Promise<void> {
  const result = await launchApp({ env: env() })
  app = result.app
  page = result.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await waitForEditor(page)
}

test.beforeAll(async () => {
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1138-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-1138-docs-'))
  writeFileSync(join(qaUserDataDir, 'settings.json'), JSON.stringify({ defaultSaveDirectory: qaDocsDir }, null, 2))
  await launch()
  await open('1138-other.md', '# Other\n\nA short one.\n')
  otherDocId = (await getAnnotationDocId(page))!
  expect(otherDocId).toBeTruthy()
})

test.afterAll(async () => {
  await app.close().catch(() => {})
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

async function open(name: string, body: string): Promise<void> {
  writeFileSync(join(qaDocsDir, name), body)
  expect((await executeProseTool(page, 'open_file', { path: join(qaDocsDir, name) })).success).toBe(true)
  await waitForEditor(page)
  await page.waitForTimeout(300)
}

async function clickTab(name: string, firstLine: string): Promise<void> {
  await page.locator('li button', { hasText: name }).first().click()
  await expect
    .poll(async () => page.evaluate(() => (window as any).__prose_editor.state.doc.textContent))
    .toContain(firstLine)
}

/** The text the rendered highlight covers, '|' between separate runs. */
async function highlighted(): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.ProseMirror .ai-annotation'))
      .map((e) => e.textContent)
      .join('|'),
  )
}

type Row = { documentId: string; detached?: boolean; anchorText?: string }

/** The rows under the probe's key are live and its own; the other document's key holds nothing. */
async function rowsAreOwn(docId: string): Promise<Row[]> {
  const rows = (await readAnnotationsFromDB(page, docId)) as Row[]
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    expect(row.documentId).toBe(docId)
    expect(row.detached).toBeFalsy()
  }
  expect(await readAnnotationsFromDB(page, otherDocId)).toEqual([])
  return rows
}

/** Each row carries the text under it (#1146), which is what the relaunch re-anchors by. */
async function anchorsAreOwn(docId: string, base: string): Promise<void> {
  for (const row of await rowsAreOwn(docId)) expect(base).toContain(String(row.anchorText))
}

/** Edit the middle paragraph through the tool with provenance, so it carries an annotation. */
async function annotate(name: string): Promise<{ base: string; docId: string }> {
  await open(name, DOC)
  const read = await executeProseTool(page, 'read_document', {})
  const nodes = (read.data as { nodes: Array<{ id: string; content?: string }> }).nodes
  const target = nodes.find((n) => (n.content ?? '').startsWith('Some '))!
  const docId = (await getAnnotationDocId(page))!
  const edited = await executeProseTool(
    page,
    'edit',
    { nodeId: target.id, search: target.content, content: 'Some rewritten text.' },
    'create',
    { model: 'Claude Test', conversationId: 'c-1138', messageId: `m-${name}`, documentId: docId },
  )
  expect(edited.success, JSON.stringify(edited)).toBe(true)
  await expect.poll(async () => (await getAnnotations(page)).length).toBeGreaterThan(0)
  await page.waitForTimeout(600)
  const base = await highlighted()
  expect(base).toContain('rewritten text.')
  await rowsAreOwn(docId)
  return { base, docId }
}

async function clickEndOfIntro(): Promise<void> {
  await page.locator('.ProseMirror p', { hasText: 'Intro paragraph' }).first().click()
  await page.keyboard.press('End')
}

async function switchAwayAndBack(name: string): Promise<void> {
  await page.waitForTimeout(700) // past the projections and the annotation write
  await clickTab('1138-other.md', 'Other')
  await page.waitForTimeout(300)
  await clickTab(name, 'Probe')
  await page.waitForTimeout(800)
}

test('a trailing space left above the annotation does not shift it on a tab switch', async () => {
  const { base, docId } = await annotate('1138-trailing.md')
  await clickEndOfIntro()
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace') // "words." gone, space left behind
  await switchAwayAndBack('1138-trailing.md')
  expect(await highlighted()).toBe(base)
  await anchorsAreOwn(docId, base)
})

test('a run of spaces typed above the annotation does not shift it on a tab switch', async () => {
  const { base, docId } = await annotate('1138-spaces.md')
  await clickEndOfIntro()
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('  ')
  await switchAwayAndBack('1138-spaces.md')
  expect(await highlighted()).toBe(base)
  await anchorsAreOwn(docId, base)
})

test('the same edit survives a relaunch', async () => {
  const { base, docId } = await annotate('1138-relaunch.md')
  await clickEndOfIntro()
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace')
  await page.waitForTimeout(1_600) // the session save and the annotation write both settle

  await app.close()
  await launch()
  await expect.poll(async () => page.evaluate(() => (window as any).__prose_editor.state.doc.textContent)).toContain('rewritten text.')
  await expect.poll(highlighted, { timeout: 5_000 }).toBe(base)
  await anchorsAreOwn(docId, base)
})
