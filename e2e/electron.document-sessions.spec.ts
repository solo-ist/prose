/**
 * Per-tab document sessions — the acceptance cases from
 * docs/architecture/editor-state.md §12: PR 1 (#1145) owns 1, 5, 7, 8 and 10,
 * PR 2 (#1146) adds 2 and 4, PR 3 (#1147) adds 6; plus the source-text
 * tripwires that keep the session layer the only place a document's
 * EditorState is created, swapped in, or persisted, and the record stores
 * gone.
 *
 * Every record set (AI annotations, comment threads, suggestions) is checked
 * straight from IndexedDB, keyed by document id, after each switch: the §G
 * failure wrote one document's records under another document's key on an
 * ordinary switch, and these are the keys it contaminated.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  executeProseTool,
  getAnnotations,
  getAnnotationDocId,
  selectors,
  openChat,
} from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const APP_VERSION: string = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

let app: ElectronApplication
let page: Page
let userDataDir: string
let docsDir: string

/* eslint-disable @typescript-eslint/no-explicit-any */

test.describe('document sessions', () => {
// Each case launches its own profile: the tab bar collapses past a handful
// of tabs, and the cases open up to twenty.
test.beforeEach(async () => {
  test.setTimeout(120_000)
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1145-'))
  docsDir = mkdtempSync(join(tmpdir(), 'prose-1145-docs-'))
  // The chat cases (11, 12) need a configured, consented chat: a fake key
  // (never sent, the stream is stubbed in main), create mode, and the
  // release notes already seen so no modal covers the panel (#1113).
  const chat = /^case 1[12]/.test(test.info().title)
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify(
      {
        defaultSaveDirectory: docsDir,
        featureFlags: { aiPipelineDebug: true },
        ...(chat
          ? {
              aiConsent: { consented: true, consentedAt: '2025-01-01T00:00:00.000Z' },
              llm: { provider: 'anthropic', apiKey: 'sk-ant-test-1148', model: 'claude-sonnet-5-5' },
              toolMode: 'create',
              lastSeenVersion: APP_VERSION,
            }
          : {}),
      },
      null,
      2,
    ),
  )
  await launch()
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(docsDir, { recursive: true, force: true })
})

async function launch(): Promise<void> {
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9230' } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await waitForEditor(page)
}

interface TabInfo {
  tabId: string
  title: string
  path: string | null
  documentId: string
  isActive: boolean
}

async function tabs(): Promise<TabInfo[]> {
  const result = await executeProseTool(page, 'list_tabs', {})
  expect(result.success).toBe(true)
  return (result.data as { tabs: TabInfo[] }).tabs
}

async function tabByTitle(title: string): Promise<TabInfo> {
  const found = (await tabs()).find((t) => t.title === title)
  expect(found, `tab "${title}"`).toBeTruthy()
  return found!
}

const activeTabId = () => page.evaluate(() => (window as any).__prose_tools.getActiveTabId() as string | null)
const docText = () => page.evaluate(() => (window as any).__prose_editor.state.doc.textContent as string)
const commentDocId = () => page.evaluate(() => (window as any).__prose_tools.getCommentDocId() as string | null)
const liveCommentIds = () =>
  page.evaluate(() => ((window as any).__prose_tools.getCommentStore() as Array<{ id: string }>).map((c) => c.id).sort())
const sessionTabIds = () => page.evaluate(() => (window as any).__prose_tools.getSessionTabIds() as string[])
const projectionStats = () =>
  page.evaluate(() => (window as any).__prose_tools.getProjectionStats() as Record<string, number>)

type Kind = 'annotations' | 'comments' | 'suggestions'
async function readDB(kind: Kind, documentId: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    ({ kind, documentId }) => {
      const tools = (window as any).__prose_tools
      const load = { annotations: tools.loadAnnotationsFromDB, comments: tools.loadCommentsFromDB, suggestions: tools.loadSuggestionsFromDB }[kind]
      return load(documentId)
    },
    { kind, documentId },
  )
}

async function openDoc(name: string, content: string, firstLine: string): Promise<TabInfo> {
  const path = join(docsDir, name)
  writeFileSync(path, content)
  const opened = await executeProseTool(page, 'open_file', { path })
  expect(opened.success, `open_file ${name}: ${JSON.stringify(opened)}`).toBe(true)
  await waitForEditor(page)
  await expect.poll(docText).toContain(firstLine)
  return tabByTitle(name.replace(/\.md$/, ''))
}

async function selectTab(tab: TabInfo, firstLine: string): Promise<void> {
  const result = await executeProseTool(page, 'select_tab', { tabId: tab.tabId })
  expect(result.success, JSON.stringify(result)).toBe(true)
  await expect.poll(docText).toContain(firstLine)
}

async function clickTab(tab: TabInfo, firstLine: string): Promise<void> {
  await page.locator('li button', { hasText: tab.title }).first().click()
  await expect.poll(activeTabId).toBe(tab.tabId)
  await expect.poll(docText).toContain(firstLine)
}

/** Position of `needle` inside the first textblock that contains it. */
async function posOf(needle: string): Promise<number> {
  const pos = await page.evaluate((needle) => {
    const editor = (window as any).__prose_editor
    let found = -1
    editor.state.doc.descendants((node: any, pos: number) => {
      if (found === -1 && node.isTextblock && node.textContent.includes(needle)) {
        found = pos + 1 + node.textContent.indexOf(needle)
      }
      return found === -1
    })
    return found
  }, needle)
  expect(pos, `text "${needle}"`).toBeGreaterThan(-1)
  return pos
}

/** Source mode through the Toolbar button, as the source-mode-authority spec does. */
async function enterSource(): Promise<void> {
  await page.locator('[aria-label="Source mode"]').click()
  await page.waitForSelector(selectors.sourceEditor, { timeout: 5_000 })
}

async function exitSource(): Promise<void> {
  await page.locator('[aria-label="WYSIWYG mode"]').click()
  await page.waitForSelector('.ProseMirror', { timeout: 5_000 })
}

const sourceState = (tabId?: string) =>
  page.evaluate(
    (tabId) =>
      (window as any).__prose_tools.getSourceState(tabId) as {
        mode: 'rich' | 'source'
        text: string | null
        selection: { anchor: number; head: number } | null
        folds: Array<[number, number]>
      } | null,
    tabId,
  )

async function commentOn(needle: string, id: string): Promise<void> {
  const from = await posOf(needle)
  await page.evaluate(
    ({ id, from, to }) => {
      const editor = (window as any).__prose_editor
      editor.chain().focus().setTextSelection({ from, to }).setComment({ id, comment: `thread ${id}` }).run()
    },
    { id, from, to: from + needle.length },
  )
  await expect.poll(liveCommentIds).toContain(id)
}

/** A suggestion on `needle`, stamped with `documentId` the way the executor stamps it from the chat's provenance. */
async function suggestOn(needle: string, id: string, documentId?: string): Promise<void> {
  const from = await posOf(needle)
  await page.evaluate(
    ({ id, from, to, original, documentId }) => {
      const editor = (window as any).__prose_editor
      editor.commands.setTextSelection({ from, to })
      editor.commands.setAISuggestion({ id, type: 'edit', originalText: original, suggestedText: `${original}, rewritten`, explanation: 'qa', documentId })
    },
    { id, from, to: from + needle.length, original: needle, documentId },
  )
  await expect.poll(liveSuggestionIds).toContain(id)
}

async function acceptSuggestion(id: string): Promise<void> {
  await page.evaluate((id) => (window as any).__prose_editor.commands.acceptAISuggestion(id), id)
  await expect.poll(liveSuggestionIds).not.toContain(id)
}

const paintedAnnotations = () => page.evaluate(() => document.querySelectorAll('.ProseMirror .ai-annotation').length)

async function liveSuggestionIds(): Promise<string[]> {
  return page.evaluate(() => {
    const editor = (window as any).__prose_editor
    const ids = new Set<string>()
    editor.state.doc.descendants((node: any) => {
      for (const mark of node.marks) if (mark.type.name === 'aiSuggestion' && mark.attrs.id) ids.add(mark.attrs.id)
    })
    return [...ids].sort()
  })
}

/**
 * An AI edit on the paragraph containing `needle`, annotated with provenance
 * for `messageId`. `provenanceDocId` is what the chat would carry; it defaults
 * to the live id and may lag it (a rename or first save after the chat loaded).
 */
async function annotate(needle: string, replacement: string, messageId: string, provenanceDocId?: string): Promise<void> {
  const read = await executeProseTool(page, 'read_document', {})
  const nodes = (read.data as { nodes: Array<{ id: string; content?: string }> }).nodes
  const target = nodes.find((n) => (n.content ?? '').includes(needle))
  expect(target, `paragraph containing "${needle}"`).toBeTruthy()
  const documentId = provenanceDocId ?? (await getAnnotationDocId(page))
  const edited = await executeProseTool(
    page,
    'edit',
    { nodeId: target!.id, search: target!.content, content: replacement },
    'create',
    { model: 'Claude Test', conversationId: 'conversation-1145', messageId, documentId: documentId! },
  )
  expect(edited.success, JSON.stringify(edited)).toBe(true)
  await expect
    .poll(async () => (await getAnnotations(page)).filter((a) => (a.provenance as { messageId?: string }).messageId === messageId).length)
    .toBe(1)
}

async function typeAtEndOfFirstParagraph(text: string): Promise<void> {
  await page.locator('.ProseMirror p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}

async function settle(): Promise<void> {
  // Past the 500 ms projections and the stores' own writes.
  await page.waitForTimeout(800)
}

/** The text the rendered highlights cover, '|' between separate runs. */
async function paintedText(): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.ProseMirror .ai-annotation'))
      .map((e) => e.textContent)
      .join('|'),
  )
}

/** Every live record's anchorText is the text under it in the document in the view (#1146). */
async function liveAnchorsMatch(): Promise<boolean> {
  return page.evaluate(() => {
    const doc = (window as any).__prose_editor.state.doc
    const records = (window as any).__prose_tools.getAnnotations() as Array<{
      from: number
      to: number
      detached?: boolean
      anchorText?: string
    }>
    return records.every(
      (a) => a.detached || a.from === a.to || doc.textBetween(a.from, a.to, '\n') === a.anchorText,
    )
  })
}

const body = (name: string) =>
  `# ${name}\n\n${name} paragraph one.\n\n${name} paragraph two.\n\n${name} paragraph three.\n`

/**
 * Case 1 — twenty switches with an edit on each visit, half through
 * select_tab and half through the tab bar: every IndexedDB key holds only
 * its own document's records.
 */
test('every record key holds only its own document across twenty edited switches', async () => {
  test.setTimeout(180_000)
  const a = await openDoc('sessions-a.md', body('Alpha'), 'Alpha paragraph one')
  await commentOn('Alpha paragraph one', 'c-a')
  await suggestOn('Alpha paragraph three', 's-a')
  await annotate('Alpha paragraph two', 'Alpha paragraph two rewritten.', 'msg-a')
  await settle()

  const b = await openDoc('sessions-b.md', body('Beta'), 'Beta paragraph one')
  await commentOn('Beta paragraph one', 'c-b')
  await suggestOn('Beta paragraph three', 's-b')
  await annotate('Beta paragraph two', 'Beta paragraph two rewritten.', 'msg-b')
  await settle()

  const expectKeys = async () => {
    for (const [doc, comment, suggestion, message] of [
      [a, 'c-a', 's-a', 'msg-a'],
      [b, 'c-b', 's-b', 'msg-b'],
    ] as const) {
      const annotations = await readDB('annotations', doc.documentId)
      expect(annotations.length, `annotations under ${doc.title}`).toBeGreaterThan(0)
      const other = doc.title === 'sessions-a' ? 'Beta' : 'Alpha'
      for (const record of annotations) {
        expect(record.documentId, `annotation documentId under ${doc.title}`).toBe(doc.documentId)
        expect((record.provenance as { messageId: string }).messageId).toBe(message)
        // No key holds another document's text (§12 case 1, #1146).
        if (!record.detached) expect(record.anchorText, `anchorText under ${doc.title}`).toBeTruthy()
        expect(String(record.anchorText ?? '')).not.toContain(other)
      }
      const comments = await readDB('comments', doc.documentId)
      expect(comments.map((c) => c.id), `comments under ${doc.title}`).toEqual([comment])
      expect(comments[0].markedText).toBe(`${doc.title === 'sessions-a' ? 'Alpha' : 'Beta'} paragraph one`)
      const suggestions = await readDB('suggestions', doc.documentId)
      expect(suggestions.map((s) => s.id), `suggestions under ${doc.title}`).toEqual([suggestion])
    }
  }
  await expectKeys()

  let current = b
  for (let i = 0; i < 20; i++) {
    const target = current.tabId === a.tabId ? b : a
    const firstLine = target.tabId === a.tabId ? 'Alpha paragraph one' : 'Beta paragraph one'
    if (i % 2 === 0) await selectTab(target, firstLine)
    else await clickTab(target, firstLine)
    current = target
    // The mirrors belong to the document in the view, on every visit.
    expect(await getAnnotationDocId(page)).toBe(target.documentId)
    expect(await commentDocId()).toBe(target.documentId)
    expect(await liveCommentIds()).toEqual([target.tabId === a.tabId ? 'c-a' : 'c-b'])
    expect(await liveAnchorsMatch(), 'live anchors').toBe(true)
    await typeAtEndOfFirstParagraph(` v${i}`)
    await settle()
    await expectKeys()
  }
})

/**
 * Case 2 — an edit above a highlight, a switch away with typing there, a
 * return, then a relaunch: the highlight stays on its words and the other
 * document's rows stay its own. The switch and return pass since PR 1 (the
 * states persist); the relaunch re-parses the file, which is #1138's open
 * half: the serializer drops the trailing space the edit left, so the
 * stored positions are one too far unless the rows are re-anchored.
 */
test('an edit above a highlight survives a switch and a relaunch, and the other document keeps its own rows', async () => {
  test.setTimeout(150_000)
  const a = await openDoc('sessions-two-a.md', body('Alpha'), 'Alpha paragraph one')
  await annotate('Alpha paragraph two', 'Alpha paragraph two rewritten.', 'msg-two-a')
  await settle()
  const painted = await paintedText()
  expect(painted).toContain('rewritten')

  const b = await openDoc('sessions-two-b.md', body('Beta'), 'Beta paragraph one')
  await annotate('Beta paragraph two', 'Beta paragraph two rewritten.', 'msg-two-b')
  await settle()
  const paintedB = await paintedText()
  expect(paintedB).toContain('rewritten')

  const ownRows = async (doc: TabInfo, message: string) => {
    const rows = await readDB('annotations', doc.documentId)
    expect(rows.length, `rows under ${doc.title}`).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.documentId, `documentId under ${doc.title}`).toBe(doc.documentId)
      expect((row.provenance as { messageId: string }).messageId).toBe(message)
      expect(row.detached, `detached under ${doc.title}`).toBeFalsy()
    }
    return rows
  }
  const ownAnchors = async (doc: TabInfo, message: string, text: string) => {
    for (const row of await ownRows(doc, message)) {
      expect(text, `anchorText under ${doc.title}`).toContain(String(row.anchorText))
    }
  }

  // Back in A: delete "one." at the end of the first paragraph, leaving a
  // trailing space that the markdown round trip drops.
  await clickTab(a, 'Alpha paragraph one')
  await page.locator('.ProseMirror p').first().click()
  await page.keyboard.press('End')
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
  await settle()
  await clickTab(b, 'Beta paragraph one')
  await typeAtEndOfFirstParagraph(' typed')
  await settle()
  await clickTab(a, 'Alpha paragraph')
  expect(await paintedText()).toBe(painted)
  await ownRows(a, 'msg-two-a')
  await ownRows(b, 'msg-two-b')

  // The session draft (1 s debounce) and the annotation write both settle.
  await page.waitForTimeout(1_600)
  await app.close()
  await launch()
  await expect.poll(docText, { timeout: 10_000 }).toContain('Alpha paragraph')
  await expect.poll(paintedText, { timeout: 10_000 }).toBe(painted)
  const bAgain = await tabByTitle(b.title)
  await clickTab(bAgain, 'Beta paragraph')
  await expect.poll(paintedText, { timeout: 10_000 }).toBe(paintedB)

  // Every live record carries the text under it, under its own key (#1146).
  expect(await liveAnchorsMatch()).toBe(true)
  await ownAnchors(b, 'msg-two-b', paintedB)
  await ownAnchors(a, 'msg-two-a', painted)
})

/**
 * Case 3 — A in source mode with its caret on a line, switch to B through
 * the tab bar, return: A is still in source mode with its text and caret;
 * exiting without changes writes nothing and does not dirty A. Fails on the
 * release head: a switch exits source mode, so A comes back rich.
 */
test('case 3: a tab stays in source mode with its caret across a switch, and an untouched exit is clean', async () => {
  const a = await openDoc('sessions-three-a.md', body('Golf'), 'Golf paragraph one')
  const bytesBefore = readFileSync(a.path!, 'utf8')
  const b = await openDoc('sessions-three-b.md', body('Hotel'), 'Hotel paragraph one')
  await clickTab(a, 'Golf paragraph one')

  await enterSource()
  // Put the caret at the end of the third paragraph's line.
  await page.locator('.cm-line', { hasText: 'Golf paragraph three.' }).first().click()
  await page.keyboard.press('End')

  await clickTab(b, 'Hotel paragraph one')
  expect(await page.locator(selectors.sourceEditor).count()).toBe(0)
  await clickTab(a, 'Golf paragraph one')
  // Behaviour first (the release head comes back rich here): the source
  // surface is shown again, with the text and the caret where they were.
  await page.waitForSelector(selectors.sourceEditor, { timeout: 5_000 })
  const caretAfter = (await sourceState())!
  expect(caretAfter.mode).toBe('source')
  expect(caretAfter.text).toContain('Golf paragraph three.')
  expect(caretAfter.selection!.head).toBe(caretAfter.text!.indexOf('Golf paragraph three.') + 'Golf paragraph three.'.length)
  expect(caretAfter.selection!.anchor).toBe(caretAfter.selection!.head)

  await exitSource()
  expect((await sourceState())!.mode).toBe('rich')
  expect(await page.evaluate(() => (window as any).__prose_tools.getDocumentIsDirty())).toBe(false)
  await page.keyboard.press('Meta+s')
  await settle()
  expect(readFileSync(a.path!, 'utf8')).toBe(bytesBefore)
})

/**
 * Case 4 — exit source mode with an edit, then one undo: the pre-edit
 * document is back, the annotation is live on its words and the comment
 * thread's mark is on its text. The undo is a whole-document replace
 * carrying no meta of ours; mapping through it collapsed every range, so
 * the annotation half failed at 5b67ba9; the comment half is PR 6's.
 */
test('one undo after a source-mode exit restores the document with its annotation and comment attached', async () => {
  await openDoc('sessions-four.md', body('Gamma'), 'Gamma paragraph one')
  await annotate('Gamma paragraph two', 'Gamma paragraph two rewritten.', 'msg-four')
  await commentOn('Gamma paragraph one', 'c-four')
  await settle()
  const painted = await paintedText()
  expect(painted).toContain('rewritten')
  const before = await docText()

  await page.locator('[aria-label="Source mode"]').click()
  await page.waitForSelector(selectors.sourceEditor, { timeout: 5_000 })
  await page.locator('.cm-line', { hasText: 'Gamma paragraph three' }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' typed in source')
  await page.waitForTimeout(1_200)
  await page.locator('[aria-label="WYSIWYG mode"]').click()
  await page.waitForSelector(selectors.editor, { state: 'visible', timeout: 5_000 })
  await expect.poll(docText).toContain('typed in source')
  expect(await paintedText()).toBe(painted)

  // One undo step reverts the whole source edit (decision 10).
  expect(await page.evaluate(() => (window as any).__prose_editor.commands.undo())).toBe(true)
  await expect.poll(docText).toBe(before)
  expect(await paintedText()).toBe(painted)
  const live = (await getAnnotations(page)) as Array<{ detached?: boolean }>
  expect(live.length).toBeGreaterThan(0)
  expect(live.every((a) => !a.detached)).toBe(true)
  expect(await liveAnchorsMatch()).toBe(true)
  // The comment thread survived the round trip and the undo on its text.
  expect(await liveCommentIds()).toEqual(['c-four'])
  await expect.poll(() => page.locator('.comment-mark').first().textContent()).toBe('Gamma paragraph one')
})

/**
 * Case 5 — five tabs survive a relaunch, each keyed to itself; only the
 * active tab has a session before any click, and each click adds one.
 */
test('a relaunch restores five tabs lazily, each with its own records', async () => {
  test.setTimeout(120_000)
  const docs: TabInfo[] = []
  for (let i = 1; i <= 5; i++) {
    const name = `Five${i}`
    const tab = await openDoc(`sessions-five-${i}.md`, body(name), `${name} paragraph one`)
    await commentOn(`${name} paragraph one`, `c-five-${i}`)
    await settle()
    docs.push(tab)
  }
  await settle()

  await app.close()
  await launch()

  const restored = await tabs()
  for (const doc of docs) {
    expect(restored.find((t) => t.tabId === doc.tabId)?.documentId, doc.title).toBe(doc.documentId)
  }
  const activeAfterLaunch = await activeTabId()
  expect(activeAfterLaunch).toBe(docs[4].tabId)
  expect(await sessionTabIds()).toEqual([docs[4].tabId])
  expect(await commentDocId()).toBe(docs[4].documentId)

  for (let i = 0; i < 5; i++) {
    const doc = docs[i]
    await clickTab(doc, `Five${i + 1} paragraph one`)
    const ids = await sessionTabIds()
    expect(ids, `sessions after clicking ${doc.title}`).toContain(doc.tabId)
    expect(ids.length).toBe(i === 4 ? 5 : i + 2)
    expect(await commentDocId()).toBe(doc.documentId)
    expect(await liveCommentIds()).toEqual([`c-five-${i + 1}`])
    expect((await readDB('comments', doc.documentId)).map((c) => c.id)).toEqual([`c-five-${i + 1}`])
  }
})

/**
 * Case 7 — a rename and a first save move every record set to the new
 * path-derived id (comments and suggestions did not follow before).
 */
test('rename and first save carry comments, suggestions and annotations to the new id', async () => {
  const d = await openDoc('sessions-d.md', body('Delta'), 'Delta paragraph one')
  await commentOn('Delta paragraph one', 'c-d')
  await suggestOn('Delta paragraph three', 's-d', d.documentId)
  await annotate('Delta paragraph two', 'Delta paragraph two rewritten.', 'msg-d')
  await settle()

  const renamed = await page.evaluate((tabId) => (window as any).__prose_renameTab(tabId, 'sessions-d-renamed'), d.tabId)
  expect(renamed).toContain('sessions-d-renamed.md')
  const after = await tabByTitle('sessions-d-renamed')
  expect(after.documentId).not.toBe(d.documentId)
  expect(await commentDocId()).toBe(after.documentId)
  expect(await getAnnotationDocId(page)).toBe(after.documentId)
  expect((await readDB('comments', after.documentId)).map((c) => c.id)).toEqual(['c-d'])
  expect((await readDB('suggestions', after.documentId)).map((s) => s.id)).toEqual(['s-d'])
  expect((await readDB('annotations', after.documentId)).map((a) => a.documentId)).toEqual([after.documentId])

  // Records made after the rename land under the new id even when their
  // source still carries the old one: a suggestion stamped before the rename
  // and accepted after it, and an AI edit whose provenance is the chat's
  // pre-rename binding (it follows the identity only with PR 4). The store
  // refuses a foreign id, so without the live identity neither would paint
  // (operator QA of PR #1165: "no annotation after accepting a suggestion").
  const paintedBeforeAccept = await paintedAnnotations()
  await acceptSuggestion('s-d')
  await expect.poll(paintedAnnotations).toBeGreaterThan(paintedBeforeAccept)
  await annotate('Delta paragraph three', 'Delta paragraph three rewritten again.', 'msg-d-stale', d.documentId)
  await settle()
  const liveAfterRename = await getAnnotations(page)
  expect(liveAfterRename.length).toBeGreaterThanOrEqual(3)
  expect(liveAfterRename.every((a) => a.documentId === after.documentId)).toBe(true)
  expect((await readDB('annotations', after.documentId)).every((a) => a.documentId === after.documentId)).toBe(true)
  expect(await readDB('annotations', d.documentId)).toHaveLength(1)

  const created = await executeProseTool(page, 'new_file', { content: 'Untitled body text.\n\nUntitled second line.\n' })
  expect(created.success).toBe(true)
  await expect.poll(docText).toContain('Untitled body text')
  const untitledId = (await tabs()).find((t) => t.isActive)!.documentId
  await commentOn('Untitled body', 'c-u')
  await suggestOn('Untitled second', 's-u', untitledId)
  await settle()

  const savedPath = join(docsDir, 'sessions-u.md')
  const saved = await executeProseTool(page, 'save_file', { path: savedPath })
  expect(saved.success, JSON.stringify(saved)).toBe(true)
  const savedTab = (await tabs()).find((t) => t.path === savedPath)
  expect(savedTab, 'saved tab').toBeTruthy()
  expect(savedTab!.documentId).not.toBe(untitledId)
  expect(await commentDocId()).toBe(savedTab!.documentId)
  expect(await getAnnotationDocId(page)).toBe(savedTab!.documentId)
  expect((await readDB('comments', savedTab!.documentId)).map((c) => c.id)).toEqual(['c-u'])
  expect((await readDB('suggestions', savedTab!.documentId)).map((s) => s.id)).toEqual(['s-u'])
  expect(readFileSync(savedPath, 'utf8')).toContain('Untitled body text.')

  // The same after a first save: the suggestion was stamped with the untitled id.
  const paintedBeforeSavedAccept = await paintedAnnotations()
  await acceptSuggestion('s-u')
  await expect.poll(paintedAnnotations).toBeGreaterThan(paintedBeforeSavedAccept)
  await settle()
  const savedAnnotations = await readDB('annotations', savedTab!.documentId)
  expect(savedAnnotations).toHaveLength(1)
  expect(savedAnnotations[0].documentId).toBe(savedTab!.documentId)
  expect(await readDB('annotations', untitledId)).toHaveLength(0)
})

/**
 * Case 8 — select_tab, open_file on an open file and the tab bar leave the
 * tab, store and IndexedDB state identical after one sequence.
 */
test('select_tab, open_file and the tab bar produce the same state', async () => {
  const e = await openDoc('sessions-e.md', body('Echo'), 'Echo paragraph one')
  await commentOn('Echo paragraph one', 'c-e')
  await settle()
  const f = await openDoc('sessions-f.md', body('Foxtrot'), 'Foxtrot paragraph one')
  await settle()

  const snapshot = async (expected: TabInfo) => {
    expect(await activeTabId()).toBe(expected.tabId)
    expect(await commentDocId()).toBe(expected.documentId)
    expect(await getAnnotationDocId(page)).toBe(expected.documentId)
    expect(await liveCommentIds()).toEqual(expected.tabId === e.tabId ? ['c-e'] : [])
    expect((await readDB('comments', e.documentId)).map((c) => c.id)).toEqual(['c-e'])
    expect((await readDB('comments', f.documentId)).map((c) => c.id)).toEqual([])
  }

  await selectTab(e, 'Echo paragraph one')
  await snapshot(e)
  const viaOpen = await executeProseTool(page, 'open_file', { path: f.path! })
  expect(viaOpen.success).toBe(true)
  await expect.poll(docText).toContain('Foxtrot paragraph one')
  await snapshot(f)
  await clickTab(e, 'Echo paragraph one')
  await snapshot(e)
  await clickTab(f, 'Foxtrot paragraph one')
  await snapshot(f)
  await selectTab(e, 'Echo paragraph one')
  await snapshot(e)
})

/**
 * Case 10 — a switch after the projections have landed serialises nothing,
 * and twenty open tabs of a 100 KB document stay under a heap ceiling.
 */
test('a settled switch serialises nothing and twenty large tabs fit the heap ceiling', async () => {
  test.setTimeout(180_000)
  const g = await openDoc('sessions-g.md', body('Golf'), 'Golf paragraph one')
  const h = await openDoc('sessions-h.md', body('Hotel'), 'Hotel paragraph one')
  await typeAtEndOfFirstParagraph(' settled')
  await settle()
  const before = await projectionStats()
  await selectTab(g, 'Golf paragraph one')
  await clickTab(h, 'Hotel paragraph one')
  const after = await projectionStats()
  expect(after.serializations - before.serializations, 'serialisations spent by two settled switches').toBe(0)

  const line = 'A line of the large fixture, kept to about seventy characters wide.'
  const large = `# Large\n\n${Array.from({ length: 1_400 }, (_, i) => `${line} ${i}`).join('\n\n')}\n`
  expect(large.length).toBeGreaterThan(100_000)
  for (let i = 0; i < 20; i++) {
    await openDoc(`sessions-large-${i}.md`, large, 'A line of the large fixture')
  }
  expect((await sessionTabIds()).length).toBeGreaterThanOrEqual(20)
  const heap = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize as number | undefined)
  console.log(`[document-sessions] usedJSHeapSize with 20 large tabs: ${heap}`)
  // 97.4 MB on the first run (2026-11-01, Electron 45, this machine); 2× headroom.
  const HEAP_CEILING_BYTES = 200_000_000
  expect(heap, 'performance.memory available').toBeTruthy()
  expect(heap!).toBeLessThan(HEAP_CEILING_BYTES)
})


/**
 * Case 6 — a share pull for a document open in a background tab lands in
 * that tab's state and IndexedDB; activating it shows the merged thread
 * without a reload. The pull itself is stubbed at the IPC handler (the
 * renderer's merge is the subject here; share-sync.spec drives main's real
 * pull against a loopback gateway); the share entry lookup is the real local
 * read of share-sync.json. Fails on the release head before #1147: the sync
 * refuses any document that is not the active one.
 */
test('case 6: a share pull merges into a background tab and shows on activation without a reload', async () => {
  const a = await openDoc('sessions-six-a.md', body('India'), 'India paragraph one')
  const b = await openDoc('sessions-six-b.md', body('Juliet'), 'Juliet paragraph one')
  await commentOn('Juliet paragraph two', 'c-b')
  await settle()
  expect(await activeTabId()).toBe(b.tabId)
  expect(await sessionTabIds()).toEqual(expect.arrayContaining([a.tabId, b.tabId]))

  // A is published (a local share entry; no gatewayOrigin, so the lookup
  // returns it whatever gateway the settings name) and the gateway holds one
  // reviewer row on A's text.
  writeFileSync(
    join(userDataDir, 'share-sync.json'),
    JSON.stringify(
      {
        version: 1,
        shares: {
          'pub-six': {
            publicationId: 'pub-six',
            shareUrl: 'https://share.example/s/tok-six',
            localPath: a.path,
            documentId: a.documentId,
            title: 'India',
            publishRev: 'rev1',
            revCount: 1,
            publishedAt: new Date(Date.now() - 60_000).toISOString(),
            lastPulledAt: null,
            lastCommentCursor: null,
            revokedAt: null,
            syncMode: 'publish',
          },
        },
      },
      null,
      2,
    ),
  )
  const row = {
    id: 'row-six',
    parentId: null,
    markedText: 'India paragraph two',
    occurrenceIndex: 0,
    commentText: 'Reviewer note on India',
    authorName: 'Reviewer Rae',
    fromAuthor: false,
    resolvedAt: null,
    publishRev: 'rev1',
    createdAt: new Date().toISOString(),
  }
  await app.evaluate(({ ipcMain }, row) => {
    ipcMain.removeHandler('share:pullComments')
    ipcMain.handle('share:pullComments', async () => ({ ok: true, comments: [row], nextCursor: null }))
  }, row)

  const opensBefore = (await projectionStats()).opens
  const outcome = await page.evaluate((id) => (window as any).__prose_share.sync(id), a.documentId)
  expect(outcome, JSON.stringify(outcome)).toEqual({ ok: true, added: 1 })

  // B, still shown, is untouched in state and in IndexedDB.
  expect(await commentDocId()).toBe(b.documentId)
  expect(await liveCommentIds()).toEqual(['c-b'])
  expect((await readDB('comments', b.documentId)).map((c) => c.id)).toEqual(['c-b'])
  // A's background state holds the thread, anchored on its text, and its row is stored.
  const background = await page.evaluate(
    (tabId) => (window as any).__prose_tools.getSessionThreads(tabId) as { threads: any[]; markIds: string[] },
    a.tabId,
  )
  expect(background.threads.map((c) => [c.id, c.shareId, c.anchorLost])).toEqual([['row-six', 'row-six', false]])
  expect(background.markIds).toEqual(['row-six'])
  const rowsA = await readDB('comments', a.documentId)
  expect(rowsA.map((c) => [c.id, c.shareId, c.anchorLost])).toEqual([['row-six', 'row-six', false]])

  // Activating A shows the thread on its text: no session rebuilt, no reload.
  await clickTab(a, 'India paragraph one')
  await expect.poll(liveCommentIds).toEqual(['row-six'])
  await expect.poll(() => page.locator('.comment-mark').first().textContent()).toBe('India paragraph two')
  expect((await projectionStats()).opens).toBe(opensBefore)
  expect(await sessionTabIds()).toEqual(expect.arrayContaining([a.tabId, b.tabId]))
})

// ---------------------------------------------------------------------------
// A chat turn in flight (#1148): the LLM is a scripted stub installed on the
// main process's `llm:stream` handler, one step per roundtrip; a step can
// hold until the spec releases it, which is when the spec switches or closes
// tabs. The real renderer path runs: useChat, the chat store, the tool loop,
// executeTool with the turn's binding.
// ---------------------------------------------------------------------------

interface TurnStep {
  text: string
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>
  hold?: boolean
}

async function installFakeLLM(script: TurnStep[]): Promise<void> {
  await app.evaluate(({ ipcMain }, script) => {
    const g = globalThis as any
    g.__turn = { script, requests: [] as unknown[], gates: {} as Record<number, () => void> }
    ipcMain.removeHandler('llm:stream')
    ipcMain.handle('llm:stream', async (event, req: { streamId: string; messages: unknown[] }) => {
      const n = g.__turn.requests.push(req.messages) - 1
      const step = g.__turn.script[n] ?? { text: 'Done.', toolCalls: [] }
      if (step.text) event.sender.send('llm:stream:chunk', { streamId: req.streamId, delta: step.text })
      if (step.hold) await new Promise<void>((resolve) => { g.__turn.gates[n] = resolve })
      event.sender.send('llm:stream:complete', {
        streamId: req.streamId,
        content: step.text,
        toolCalls: step.toolCalls.length > 0 ? step.toolCalls : undefined,
      })
      return { success: true }
    })
  }, script)
}

const turnRequests = () => app.evaluate(() => (globalThis as any).__turn.requests.length as number)
const turnRequest = (n: number) => app.evaluate((_, n) => (globalThis as any).__turn.requests[n] as Array<{ role: string; content: unknown }>, n)
const releaseGate = (n: number) => app.evaluate((_, n) => { (globalThis as any).__turn.gates[n]?.() }, n)
const chatState = () => page.evaluate(() => (window as any).__prose_chat.getState() as {
  activeConversationId: string | null
  conversationsDocumentId: string | null
  isStreaming: boolean
  turns: Record<string, { streamId: string; messageId: string; binding: { documentId: string; tabId: string | null; path: string | null } }>
  conversations: Array<{ id: string; documentId: string; messages: Array<{ id: string; role: string; content: string }> }>
  parked: Record<string, Array<{ id: string; documentId: string; messages: Array<{ id: string; role: string; content: string }> }>>
})
const sessionState = (tabId: string) =>
  page.evaluate(
    (tabId) => (window as any).__prose_tools.getSessionState(tabId) as { documentId: string; text: string; annotations: Array<Record<string, unknown>>; suggestionIds: string[] } | null,
    tabId,
  )
/** The pipeline log, each entry flattened to `{ event, ...data }`. */
const toolCallLog = () =>
  page.evaluate(() => {
    const raw = (window as any).__prose_debug.exportLog() as string
    const entries = JSON.parse(raw) as Array<{ event: string; data: Record<string, unknown> }>
    return entries.map((e) => ({ event: e.event, ...e.data })) as Array<{ event: string; [k: string]: unknown }>
  })

/** Close a tab from the tab bar; a dirty tab's "Save changes?" prompt is answered with Discard. */
async function closeTabFromBar(tab: TabInfo): Promise<void> {
  await page.locator('li', { hasText: tab.title }).first().locator('[aria-label="Close tab"]').click()
  const discard = page.getByRole('button', { name: 'Discard' })
  if (await discard.isVisible({ timeout: 2_000 }).catch(() => false)) await discard.click()
  await expect.poll(async () => (await tabs()).some((t) => t.tabId === tab.tabId)).toBe(false)
}

/** Start a turn in the chat panel: the prompt goes through sendMessage, bound to the active document. */
async function startTurn(prompt: string): Promise<void> {
  await openChat(page)
  await page.evaluate((prompt) => {
    window.dispatchEvent(new CustomEvent('prose:mode-switch-and-run', { detail: { prompt } }))
  }, prompt)
  await expect.poll(turnRequests, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
}

/** The turn's last roundtrip has no tool calls, so the loop ends as soon as its completion lands. */
async function turnEnded(): Promise<void> {
  await expect.poll(turnRequests, { timeout: 15_000 }).toBe(3)
  await settle()
}

const EDIT_A_ONE = { id: 't1', name: 'edit', args: { nodeId: 'stale', search: 'India paragraph one.', content: 'India paragraph one, edited first.' } }
const EDIT_A_THREE = { id: 't2', name: 'edit', args: { nodeId: 'stale', search: 'India paragraph three.', content: 'India paragraph three, edited later.' } }
const SUGGEST_A_TWO = { id: 't3', name: 'suggest_edit', args: { nodeId: 'stale', search: 'India paragraph two.', content: 'India paragraph two, suggested later.' } }

/**
 * Case 11 — start a turn that edits A, switch to B before it finishes. The
 * rest of the turn (an edit and a suggestion) lands in A's state and
 * IndexedDB, B is untouched, every call resolved to A's document id, and
 * the stream shows under A's conversation when A is active again. Fails on
 * the release head: the later calls act on B (NODE_NOT_FOUND) and the
 * stream text is dropped on the switch.
 */
test('case 11: a turn in flight keeps acting on its own document after a tab switch', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const b = await openDoc('sessions-eleven-b.md', body('Juliet'), 'Juliet paragraph one')
  const a = await openDoc('sessions-eleven-a.md', body('India'), 'India paragraph one')
  await installFakeLLM([
    { text: 'Editing the first paragraph.', toolCalls: [EDIT_A_ONE] },
    { text: 'Now the rest.', toolCalls: [EDIT_A_THREE, SUGGEST_A_TWO], hold: true },
    { text: 'All done.', toolCalls: [] },
  ])

  await startTurn('Edit this document.')
  // Roundtrip 1 landed on A and roundtrip 2 is held open.
  await expect.poll(turnRequests, { timeout: 15_000 }).toBe(2)
  await expect.poll(docText).toContain('edited first.')

  // Switch to B while the turn is held, then let it finish.
  await clickTab(b, 'Juliet paragraph one')
  await releaseGate(1)
  await turnEnded()

  // Behaviour first (these fail on the release head: the later calls act
  // on B and find nothing): A's rows are stored, B is untouched, the
  // model got two successes, and A shows both edits on return.
  await expect.poll(async () => (await readDB('annotations', a.documentId)).length, { timeout: 5_000 }).toBeGreaterThanOrEqual(2)
  await expect.poll(async () => (await readDB('suggestions', a.documentId)).length, { timeout: 5_000 }).toBe(1)
  expect(await docText()).toContain('Juliet paragraph three.')
  expect(await docText()).not.toContain('edited')
  expect(await getAnnotations(page)).toEqual([])
  expect(await readDB('annotations', b.documentId)).toEqual([])
  expect(await readDB('suggestions', b.documentId)).toEqual([])
  // The request carries the whole history: the last two are roundtrip 2's.
  const results = (await turnRequest(2)).filter((m) => m.role === 'tool').slice(-2)
  expect(results.length).toBe(2)
  for (const r of results) expect(String(r.content)).toContain('"success":true')

  // Then the contracts: A's state, every call resolved to A, the turn's
  // binding and the parked conversation.
  const stateA = await sessionState(a.tabId)
  expect(stateA?.text).toContain('edited later.')
  expect(stateA?.text).toContain('edited first.')
  expect(stateA?.suggestionIds.length).toBe(1)
  expect(stateA?.annotations.length).toBeGreaterThanOrEqual(2)
  const calls = (await toolCallLog()).filter((e) => e.event === 'tool:call')
  expect(calls.length).toBeGreaterThanOrEqual(3)
  for (const call of calls) expect(call.documentId).toBe(a.documentId)
  const parkedState = await chatState()
  expect(parkedState.isStreaming).toBe(false)
  expect(Object.keys(parkedState.turns)).toEqual([])
  const conversationId = parkedState.parked[a.documentId]?.[0]?.id
  expect(conversationId, 'A conversation parked').toBeTruthy()

  // Back on A: the finished stream is in A's conversation, shown.
  await clickTab(a, 'India paragraph one, edited first.')
  await expect.poll(docText).toContain('edited later.')
  await expect.poll(async () => (await chatState()).conversationsDocumentId).toBe(a.documentId)
  const shown = await chatState()
  expect(shown.conversations[0]?.id).toBe(conversationId)
  const assistant = shown.conversations[0].messages.filter((m) => m.role === 'assistant').pop()
  expect(assistant?.content).toContain('All done.')
  expect(assistant?.content).toContain('<tool-result name="edit" success="true">')
  expect(assistant?.content).toContain('<tool-result name="suggest_edit" success="true">')
  await expect.poll(() => page.locator('.ai-annotation').count()).toBeGreaterThanOrEqual(2)
})

/**
 * Case 12 — close A's tab mid-turn. A saved A reopens in the background
 * from disk and receives the rest of the turn; an untitled A fails the
 * remaining calls with an error naming it; nothing lands in B either way.
 */
test('case 12: a saved document closed mid-turn reopens in the background and takes the rest of the turn', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const b = await openDoc('sessions-twelve-b.md', body('Juliet'), 'Juliet paragraph one')
  const a = await openDoc('sessions-twelve-a.md', body('India'), 'India paragraph one')
  await installFakeLLM([
    { text: 'Editing the first paragraph.', toolCalls: [EDIT_A_ONE] },
    { text: 'Now the rest.', toolCalls: [EDIT_A_THREE], hold: true },
    { text: 'All done.', toolCalls: [] },
  ])
  await startTurn('Edit this document.')
  await expect.poll(turnRequests, { timeout: 15_000 }).toBe(2)
  await expect.poll(docText).toContain('edited first.')

  // Close A from the tab bar (dirty from the first edit: Discard).
  await closeTabFromBar(a)
  await expect.poll(activeTabId).toBe(b.tabId)
  expect((await tabs()).some((t) => t.path === a.path)).toBe(false)

  await releaseGate(1)
  await turnEnded()

  // Behaviour first (fails on the release head: no reopen, the edit aims
  // at B and finds nothing): A is back as a background tab, from disk, with
  // the later edit applied and stored; B untouched.
  const reopened = (await tabs()).find((t) => t.path === a.path)
  expect(reopened, 'A reopened').toBeTruthy()
  expect(reopened!.documentId).toBe(a.documentId)
  expect(await activeTabId()).toBe(b.tabId)
  await expect.poll(async () => (await readDB('annotations', a.documentId)).some((r) => String(r.content).includes('edited later')), { timeout: 5_000 }).toBe(true)
  expect(await docText()).toContain('Juliet paragraph three.')
  expect(await docText()).not.toContain('edited')
  expect(await readDB('annotations', b.documentId)).toEqual([])
  const results = (await turnRequest(2)).filter((m) => m.role === 'tool').slice(-1)
  expect(results.length).toBe(1)
  expect(String(results[0].content)).toContain('"success":true')

  // Then the contracts.
  const stateA = await sessionState(reopened!.tabId)
  expect(stateA?.text).toContain('edited later.')
  expect(stateA?.text).not.toContain('edited first.')
  expect(stateA?.annotations.length).toBeGreaterThanOrEqual(1)
  expect((await toolCallLog()).some((e) => e.event === 'tab:background-open' && e.path === a.path)).toBe(true)
  expect(Object.keys((await chatState()).turns)).toEqual([])
})

test('case 12: an untitled document closed mid-turn fails the rest of the turn by name and touches nothing else', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const b = await openDoc('sessions-twelve-u-b.md', body('Juliet'), 'Juliet paragraph one')
  const created = await executeProseTool(page, 'new_file', { content: body('India') })
  expect(created.success, JSON.stringify(created)).toBe(true)
  await expect.poll(docText).toContain('India paragraph one')
  const untitledId = await activeTabId()
  const a = (await tabs()).find((t) => t.tabId === untitledId && t.path === null)
  expect(a, 'untitled A').toBeTruthy()
  await installFakeLLM([
    { text: 'Editing the first paragraph.', toolCalls: [EDIT_A_ONE] },
    { text: 'Now the rest.', toolCalls: [EDIT_A_THREE], hold: true },
    { text: 'All done.', toolCalls: [] },
  ])
  await startTurn('Edit this document.')
  await expect.poll(turnRequests, { timeout: 15_000 }).toBe(2)
  await expect.poll(docText).toContain('edited first.')

  await closeTabFromBar(a!)
  await expect.poll(activeTabId).toBe(b.tabId)

  await releaseGate(1)
  await turnEnded()

  // Fails on the release head: the call aims at B and reports NODE_NOT_FOUND.
  const results = (await turnRequest(2)).filter((m) => m.role === 'tool').slice(-1)
  expect(results.length).toBe(1)
  expect(String(results[0].content)).toContain('DOCUMENT_CLOSED')
  expect(String(results[0].content)).toContain('Untitled')
  expect((await tabs()).some((t) => t.path === null)).toBe(false)
  expect(await docText()).toContain('Juliet paragraph three.')
  expect(await docText()).not.toContain('edited')
  expect(await readDB('annotations', b.documentId)).toEqual([])
  expect(Object.keys((await chatState()).turns)).toEqual([])
})
})

// ---------------------------------------------------------------------------
// Tripwires: the session layer is the only place these happen.
// ---------------------------------------------------------------------------

function rendererFiles(dir = join(ROOT, 'src/renderer')): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...rendererFiles(full))
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full)
  }
  return out
}

/** Comment lines dropped and trailing `// …` comments cut, so a tripwire never fires on its own explanation. */
function stripComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*') && !line.trimStart().startsWith('/*'))
    .map((line) => line.replace(/\s\/\/\s.*$/, ''))
    .join('\n')
}

const rel = (file: string) => file.slice(ROOT.length + 1)

test.describe('session tripwires', () => {
  // Source-level: no app launch.
  const files = rendererFiles().map((file) => ({ file: rel(file), source: stripComments(readFileSync(file, 'utf8')) }))

  test('the record writers in lib/persistence are imported only by document/session.ts', () => {
    const writers = ['saveAnnotations', 'saveComments', 'saveSuggestions', 'deleteAnnotations', 'deleteComments', 'deleteSuggestions']
    for (const { file, source } of files) {
      if (file === 'src/renderer/document/session.ts' || file === 'src/renderer/lib/persistence.ts') continue
      for (const block of source.match(/import\s*\{[^}]*\}\s*from\s*'[^']*persistence'/g) ?? []) {
        for (const writer of writers) {
          expect(block, `${file} imports ${writer} from persistence`).not.toMatch(new RegExp(`\\b${writer}\\b`))
        }
      }
    }
  })

  test('view.updateState and EditorState.create happen only in document/session.ts', () => {
    for (const { file, source } of files) {
      if (file === 'src/renderer/document/session.ts') continue
      if (source.includes("from '@codemirror/state'")) continue
      expect(source, `${file} calls view.updateState`).not.toMatch(/\bview\.updateState\(/)
      expect(source, `${file} calls EditorState.create`).not.toMatch(/\bEditorState\.create\(/)
    }
  })

  test('the editor store document is written only by the session layer and the tab actions', () => {
    for (const { file, source } of files) {
      if (file === 'src/renderer/document/session.ts' || file === 'src/renderer/tabs/actions.ts') continue
      if (file === 'src/renderer/stores/editorStore.ts') continue
      expect(source, `${file} calls setDocument({`).not.toMatch(/\bsetDocument\(\{/)
    }
  })

  test('the annotation store is gone: records are read from a state and written through its transactions', () => {
    for (const { file, source } of files) {
      expect(source, `${file} references useAnnotationStore`).not.toMatch(/\buseAnnotationStore\b/)
      expect(source, `${file} imports ai-annotations/store`).not.toMatch(/ai-annotations\/store'/)
    }
  })

  test('the comment store is gone: threads are read from a state and written through its transactions', () => {
    for (const { file, source } of files) {
      expect(source, `${file} references useCommentStore`).not.toMatch(/\buseCommentStore\b/)
      expect(source, `${file} imports comments/store`).not.toMatch(/comments\/store'/)
    }
  })

  test('the suggestion store is gone: suggestions are the marks, restored at load and persisted from a state', () => {
    for (const { file, source } of files) {
      expect(source, `${file} references useSuggestionStore`).not.toMatch(/\buseSuggestionStore\b/)
      expect(source, `${file} imports ai-suggestions/store`).not.toMatch(/ai-suggestions\/store'/)
    }
  })
})
