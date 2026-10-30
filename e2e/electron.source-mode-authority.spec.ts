/**
 * Source mode is authoritative (#1102).
 *
 * While source mode is open, CodeMirror's text is the document. Typing there
 * used to echo through the store into the hidden TipTap doc and back: the caret
 * jumped to the top, the frontmatter block vanished from the source view, and
 * on exit the whole document was re-serialized by TipTap — rewriting markup
 * the writer never touched (`__bold__` → `**bold**`, `*` bullets → `-`).
 *
 * The documents here are deliberately not byte-idempotent through the
 * serializer, so any unprompted round trip shows up as a diff on disk.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  executeProseTool,
  selectors,
  getAnnotations,
  getAnnotationDocId,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

// `__bold__`, `_em_` and `*` bullets all come back rewritten by the serializer.
const BODY = '# Heading\n\nSome __bold__ and _em_ text.\n\n* star bullet\n* second\n\nSecond paragraph.\n'
const DOC = '---\ntitle: Authority\n---\n' + BODY

test.beforeAll(async () => {
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1102-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-1102-docs-'))
  writeFileSync(join(qaUserDataDir, 'settings.json'), JSON.stringify({ defaultSaveDirectory: qaDocsDir }, null, 2))
  const result = await launchApp({
    env: { PROSE_USER_DATA_DIR: qaUserDataDir, PROSE_DOCS_DIR: qaDocsDir, PROSE_DEBUG_PORT: '9226' },
  })
  app = result.app
  page = result.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app.close().catch(() => {})
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

async function openFresh(name: string): Promise<string> {
  const path = join(qaDocsDir, name)
  writeFileSync(path, DOC)
  const opened = await executeProseTool(page, 'open_file', { path })
  expect(opened.success, `open_file ${name}`).toBe(true)
  await waitForEditor(page)
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__prose_tools.getCommentStoreNeedsRestore() === false,
    { timeout: 5_000 },
  )
  return path
}

async function enterSource(): Promise<void> {
  await page.locator('[aria-label="Source mode"]').click()
  await page.waitForSelector(selectors.sourceEditor, { timeout: 5_000 })
}

async function exitSource(): Promise<void> {
  await page.locator('[aria-label="WYSIWYG mode"]').click()
  await page.waitForSelector(selectors.editor, { state: 'visible', timeout: 5_000 })
}

/** Click the end of a source line and type, then let every debounce settle. */
async function typeAtEndOf(lineText: string, text: string): Promise<void> {
  await page.locator('.cm-line', { hasText: lineText }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
  // Source onChange + the store's 500ms debounce, with room to spare.
  await page.waitForTimeout(1_200)
}

async function saveAndRead(path: string, expectContains: string): Promise<string> {
  await page.keyboard.press('Meta+s')
  await expect.poll(() => readFileSync(path, 'utf8'), { timeout: 5_000 }).toContain(expectContains)
  return readFileSync(path, 'utf8')
}

test('typing in source mode keeps the caret and the frontmatter block', async () => {
  const path = await openFresh('1102-caret.md')
  await enterSource()

  await typeAtEndOf('Second paragraph.', ' ALPHA')
  // A caret reset would put this at the top of the document.
  await page.keyboard.type(' BETA')
  await page.waitForTimeout(1_200)

  const sourceText = await page.locator('.cm-content').innerText()
  expect(sourceText, 'frontmatter block still in the source view').toContain('title: Authority')
  expect(sourceText).toContain('Second paragraph. ALPHA BETA')

  await exitSource()
  const saved = await saveAndRead(path, 'ALPHA BETA')
  expect(saved).toContain('Second paragraph. ALPHA BETA')
})

test('a source-mode edit leaves every untouched byte alone on save', async () => {
  const path = await openFresh('1102-bytes.md')
  await enterSource()
  await typeAtEndOf('Second paragraph.', ' Added.')
  await exitSource()
  // Let the exit writeback and the mark restore both fire their onUpdate.
  await page.waitForTimeout(1_200)

  const saved = await saveAndRead(path, 'Added.')
  // trimEnd: parseMarkdown trims the body of any document with frontmatter at
  // load, so the final newline is already gone before source mode is involved
  // — a separate defect (#1105), not this round trip.
  expect(saved).toBe(DOC.replace('Second paragraph.', 'Second paragraph. Added.').trimEnd())
})

test('a comment survives a source-mode edit on a non-idempotent document', async () => {
  await openFresh('1102-comment.md')
  const read = await executeProseTool(page, 'read_document', {})
  const nodes = (read.data as { nodes: Array<{ id: string; content?: string }> }).nodes
  const target = nodes.find((n) => (n.content ?? '').startsWith('Some '))
  expect(target, 'commentable paragraph').toBeTruthy()
  const added = await executeProseTool(page, 'add_comment', { nodeId: target!.id, comment: 'Keep me.' }, 'editor')
  expect(added.success, JSON.stringify(added)).toBe(true)
  const commentId = (added.data as { id: string }).id

  await enterSource()
  await typeAtEndOf('Second paragraph.', ' Edited.')
  await exitSource()
  await page.waitForTimeout(1_500)

  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.comment-mark').length)).toBeGreaterThan(0)
  const thread = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await page.evaluate(() => (window as any).__prose_tools.getCommentStore())) as Array<Record<string, unknown>>
  ).find((c) => c.id === commentId)
  expect(thread?.resolved, 'thread still open').toBe(false)
})

test('a comment survives leaving source mode straight after typing', async () => {
  // Exit lands while the source editor's debounced write is still pending, so
  // the store changes after the exit writeback. The store then holds the bytes
  // as typed, which differ from TipTap's serialization of them — re-parsing
  // over that difference would strip the comment the exit just restored.
  await openFresh('1102-comment-fast.md')
  const read = await executeProseTool(page, 'read_document', {})
  const nodes = (read.data as { nodes: Array<{ id: string; content?: string }> }).nodes
  const target = nodes.find((n) => (n.content ?? '').startsWith('Some '))
  const added = await executeProseTool(page, 'add_comment', { nodeId: target!.id, comment: 'Keep me too.' }, 'editor')
  expect(added.success, JSON.stringify(added)).toBe(true)

  await enterSource()
  await page.locator('.cm-line', { hasText: 'Second paragraph.' }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Quick.')
  await exitSource()
  await page.waitForTimeout(1_500)

  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.comment-mark').length)).toBeGreaterThan(0)
})

test('leaving source mode straight after typing keeps the keystrokes on save', async () => {
  // The source editor's change debounce is cleared, not flushed, on unmount,
  // so the last keystrokes reach the store only through the exit writeback.
  const path = await openFresh('1102-fast-exit.md')
  await enterSource()
  await page.locator('.cm-line', { hasText: 'Second paragraph.' }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Kept.')
  await exitSource()
  await page.waitForTimeout(1_200)

  const saved = await saveAndRead(path, 'Kept.')
  expect(saved).toContain('Second paragraph. Kept.')
})

test('switching tabs straight after typing in source mode leaves the other tab alone', async () => {
  // The source editor flushes a pending change when it unmounts. On a tab
  // switch that change belongs to the tab being left, never the one opened.
  const pathA = await openFresh('1102-tab-a.md')
  const pathB = join(qaDocsDir, '1102-tab-b.md')
  writeFileSync(pathB, 'Tab B stays exactly as it was.\n')
  expect((await executeProseTool(page, 'open_file', { path: pathB })).success).toBe(true)
  await waitForEditor(page)

  const tabs = (await executeProseTool(page, 'list_tabs', {})).data as { tabs: Array<{ tabId: string; path?: string | null }> }
  const tabA = tabs.tabs.find((t) => t.path === pathA)
  const tabB = tabs.tabs.find((t) => t.path === pathB)
  expect(tabA && tabB, `both tabs listed: ${JSON.stringify(tabs)}`).toBeTruthy()

  const selA = await executeProseTool(page, 'select_tab', { tabId: tabA!.tabId })
  expect(selA.success, JSON.stringify({ selA, tabs })).toBe(true)
  await waitForEditor(page)
  await enterSource()
  await page.locator('.cm-line', { hasText: 'Second paragraph.' }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Leak.')
  expect((await executeProseTool(page, 'select_tab', { tabId: tabB!.tabId })).success).toBe(true)
  await page.waitForTimeout(1_200)

  const md = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__prose_editor.storage.markdown.getMarkdown() as string,
  )
  expect(md).toContain('Tab B stays exactly as it was.')
  expect(md).not.toContain('Leak.')
  expect(md).not.toContain('Heading')
})

// AI provenance annotations are decorations over stored positions, not marks
// matched by text. Leaving source mode reloads the TipTap doc, and mapping
// positions through a whole-document replace collapses every range: the store
// then detaches them (history-only, no highlight). QA 14.4.
async function annotateFirstParagraph(messageId: string): Promise<Record<string, unknown>> {
  const read = await executeProseTool(page, 'read_document', {})
  const nodes = (read.data as { nodes: Array<{ id: string; content?: string }> }).nodes
  const target = nodes.find((n) => (n.content ?? '').startsWith('Some '))
  expect(target, 'paragraph to edit').toBeTruthy()
  const docId = await getAnnotationDocId(page)
  const edited = await executeProseTool(
    page,
    'edit',
    { nodeId: target!.id, search: target!.content, content: 'Some rewritten text.' },
    'create',
    { model: 'Claude Test', conversationId: 'conversation-1102', messageId, documentId: docId! },
  )
  expect(edited.success, JSON.stringify(edited)).toBe(true)
  await expect
    .poll(async () => (await getAnnotations(page)).filter((a) => (a.provenance as { messageId?: string }).messageId === messageId).length)
    .toBe(1)
  return (await getAnnotations(page)).find((a) => (a.provenance as { messageId?: string }).messageId === messageId)!
}

async function coveredText(ann: Record<string, unknown>): Promise<string> {
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ from, to }) => (window as any).__prose_editor.state.doc.textBetween(from, to),
    { from: Number(ann.from), to: Number(ann.to) },
  )
}

async function liveAnnotation(messageId: string): Promise<Record<string, unknown> | undefined> {
  return (await getAnnotations(page)).find((a) => (a.provenance as { messageId?: string }).messageId === messageId)
}

test('an AI annotation survives a source-mode edit elsewhere in the document', async () => {
  await openFresh('1102-annotation.md')
  const before = await coveredText(await annotateFirstParagraph('msg-1102-annotation'))

  await enterSource()
  await typeAtEndOf('Second paragraph.', ' Edited.')
  await exitSource()
  await page.waitForTimeout(1_500)

  const ann = await liveAnnotation('msg-1102-annotation')
  expect(ann?.detached, 'annotation still anchored').toBeFalsy()
  expect(await coveredText(ann!)).toBe(before)
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.ai-annotation').length)).toBeGreaterThan(0)
})

test('an AI annotation survives leaving source mode straight after typing', async () => {
  await openFresh('1102-annotation-fast.md')
  const before = await coveredText(await annotateFirstParagraph('msg-1102-annotation-fast'))

  await enterSource()
  await page.locator('.cm-line', { hasText: 'Second paragraph.' }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Quick.')
  await exitSource()
  await page.waitForTimeout(1_500)

  const ann = await liveAnnotation('msg-1102-annotation-fast')
  expect(ann?.detached, 'annotation still anchored').toBeFalsy()
  expect(await coveredText(ann!)).toBe(before)
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.ai-annotation').length)).toBeGreaterThan(0)
})

test('an AI annotation stays on its words when text is typed later in its paragraph in source mode', async () => {
  await openFresh('1102-annotation-own.md')
  const before = await coveredText(await annotateFirstParagraph('msg-1102-annotation-own'))

  await enterSource()
  await typeAtEndOf('Some rewritten text.', ' More.')
  await exitSource()
  await page.waitForTimeout(1_500)

  const ann = await liveAnnotation('msg-1102-annotation-own')
  expect(ann?.detached, 'annotation still anchored').toBeFalsy()
  expect(await coveredText(ann!)).toBe(before)
})

// QA 14.6 (build c2ef6c7): typing inside a highlighted paragraph in source mode
// detached the whole annotation, because it was put back by exact text only. In
// the editor the same keystrokes keep the highlight and grow it around the new
// words; the source exit now maps through the edit the same way.
test('an AI annotation grows around text typed inside it in source mode', async () => {
  await openFresh('1102-annotation-inside.md')
  // The edit annotates only the changed word, not the whole sentence.
  expect(await coveredText(await annotateFirstParagraph('msg-1102-annotation-inside'))).toBe('rewritten')

  await enterSource()
  await page.locator('.cm-line', { hasText: 'Some rewritten text.' }).first().click()
  await page.keyboard.press('Home')
  for (let i = 0; i < 'Some re'.length; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.type('ally ')
  await page.waitForTimeout(1_200)
  await exitSource()
  await page.waitForTimeout(1_500)

  const ann = await liveAnnotation('msg-1102-annotation-inside')
  expect(ann?.detached, 'annotation still anchored').toBeFalsy()
  expect(await coveredText(ann!)).toBe('really written')
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.ai-annotation').length)).toBeGreaterThan(0)
})
