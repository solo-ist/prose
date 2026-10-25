/**
 * Regression tests for #933: auto-resolving the last comment when its text is deleted.
 *
 * Tests:
 * 1. Deleting the text of the sole remaining comment resolves the thread (#933 fix).
 * 2. Toggling source mode with one open comment does NOT resolve it (invariant guard).
 * 3-5. An AI replacement over a comment — single accept, accept-all — keeps
 *    the thread open as anchorLost; an `edit` write keeps it anchored (#1099).
 *
 * Every test uses a fresh markdown file per case, a single comment added via the
 * add_comment tool, and programmatic editor manipulation so no LLM calls are made.
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
  selectors,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

test.beforeAll(async () => {
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-933-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-933-docs-'))
  // The open_file tool is contained to the home folder + user-chosen workspace
  // roots (#918); name the fixture dir as the default save directory so the
  // harness can open fixtures from tmpdir.
  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify({ defaultSaveDirectory: qaDocsDir }, null, 2),
  )

  const result = await launchApp({
    env: {
      PROSE_USER_DATA_DIR: qaUserDataDir,
      PROSE_DOCS_DIR: qaDocsDir,
      // Use a unique DevTools port so this instance can run alongside a dev
      // server already bound to 9222. The built app uses `is.dev` (true for
      // un-packaged builds) and tries to bind the debug port — a collision
      // kills the app before any window appears.
      PROSE_DEBUG_PORT: '9225',
    },
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the current pendingComments from the comment store. */
async function getCommentStore(testPage: Page): Promise<Array<Record<string, unknown>>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return testPage.evaluate(() => (window as any).__prose_tools.getCommentStore())
}

/**
 * Open a fresh markdown file and wait for the editor.
 */
async function openFreshFile(testPage: Page, name: string, content: string): Promise<string> {
  const mdPath = join(qaDocsDir, name)
  writeFileSync(mdPath, content)
  const openResult = await executeProseTool(testPage, 'open_file', { path: mdPath })
  expect(openResult.success, `open_file ${name}`).toBe(true)
  await waitForEditor(testPage)
  return mdPath
}

/**
 * Add a comment to the first non-trivial paragraph in the open document.
 * Returns the new comment ID.
 */
async function addCommentToFirstParagraph(testPage: Page, commentText: string): Promise<string> {
  const read = await executeProseTool(testPage, 'read_document', {})
  expect(read.success, 'read_document').toBe(true)
  interface DocNode { id: string; content?: string; children?: DocNode[] }
  const flatten = (nodes: DocNode[]): DocNode[] =>
    nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
  const node = flatten((read.data as { nodes: DocNode[] }).nodes).find(
    (n) => n.content && n.content.trim().length > 5,
  )
  expect(node, 'find non-empty node').toBeTruthy()

  const result = await executeProseTool(testPage, 'add_comment', {
    nodeId: node!.id,
    comment: commentText,
  }, 'editor')
  expect(result.success, `add_comment: ${JSON.stringify(result)}`).toBe(true)
  return (result.data as { id: string }).id
}

/** Count live comment marks visible in the editor DOM. */
async function countCommentMarks(testPage: Page): Promise<number> {
  return testPage.evaluate(() => document.querySelectorAll('.comment-mark').length)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('deleting the last comment\'s text auto-resolves the thread (#933)', async () => {
  await openFreshFile(
    page,
    '933-delete-last.md',
    '# Auto-resolve Test\n\nThis paragraph will be commented then deleted.\n',
  )

  const commentId = await addCommentToFirstParagraph(page, 'Mark this text for deletion.')

  // Wait for the restore cycle to complete (needsRestore goes false after a 100ms
  // timer in the Editor effect). Without this, autoResolveDeletedComments sees
  // needsRestore:true and returns early — correctly, since it can't know
  // whether the state change was a genuine edit or a transient strip.
  await page.waitForFunction(
    () => (window as any).__prose_tools.getCommentStoreNeedsRestore() === false,
    { timeout: 5_000 },
  )

  // Confirm the mark is live
  expect(await countCommentMarks(page)).toBeGreaterThan(0)

  // Delete the comment's marked text programmatically — find the mark's range
  // in the ProseMirror doc and dispatch a tr.delete step. This is equivalent to
  // the user selecting and deleting the text: the transaction carries no
  // preventUpdate meta, so the fix must treat it as a genuine user delete.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    const { doc } = editor.state
    let from = -1
    let to = -1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc.descendants((node: { marks: Array<{ type: { name: string } }>; nodeSize: number }, pos: number) => {
      const mark = node.marks.find((m) => m.type.name === 'comment')
      if (mark && from === -1) { from = pos; to = pos + node.nodeSize }
    })
    if (from !== -1) {
      editor.view.dispatch(editor.state.tr.delete(from, to))
    }
  })

  // The mark must be gone from the DOM
  await expect.poll(() => countCommentMarks(page)).toBe(0)

  // The thread must be resolved in the store
  await expect
    .poll(async () => (await getCommentStore(page)).find((c) => c.id === commentId)?.resolved, {
      message: 'thread is resolved',
    })
    .toBe(true)
})

test('toggling source mode with one open comment does NOT resolve it', async () => {
  await openFreshFile(
    page,
    '933-source-mode.md',
    '# Source Mode Test\n\nThis comment should survive a source-mode round-trip.\n',
  )

  const commentId = await addCommentToFirstParagraph(page, 'Should survive source mode toggle.')

  // Wait for restore cycle so the guard state is settled before toggling.
  await page.waitForFunction(
    () => (window as any).__prose_tools.getCommentStoreNeedsRestore() === false,
    { timeout: 5_000 },
  )

  // Confirm live mark before toggle
  expect(await countCommentMarks(page)).toBeGreaterThan(0)

  // Toggle to source mode — marks are transiently stripped from the TipTap doc
  // but the store keeps the thread as resolved:false.
  await page.locator('[aria-label="Source mode"]').click()
  await page.waitForSelector(selectors.sourceEditor, { timeout: 5_000 })

  // Toggle back to WYSIWYG — setContent fires (preventUpdate:true) and a 50ms
  // setTimeout then restores the comment marks. The _preventUpdateInCurrentBatch
  // flag must survive the node-ids appendTransaction that follows setContent so
  // autoResolveDeletedComments correctly skips resolution (#933 guard).
  await page.locator('[aria-label="WYSIWYG mode"]').click()
  await page.waitForSelector(selectors.editor, { state: 'visible', timeout: 5_000 })

  // Allow restoreComments setTimeout (50ms) + render cycle to complete
  await page.waitForTimeout(200)

  // The thread must NOT be resolved after the round-trip
  const comments = await getCommentStore(page)
  const thread = comments.find((c) => c.id === commentId)
  expect(thread, 'thread in store after source toggle').toBeTruthy()
  expect(thread!.resolved, 'thread is NOT resolved after source mode round-trip').toBe(false)

  // Mark must be visible again in the editor DOM (restoreComments re-applied it)
  expect(await countCommentMarks(page)).toBeGreaterThan(0)
})

// ─── AI replacements (#1099) ─────────────────────────────────────────────────
//
// Accepting a suggestion, or an `edit` tool write, replaces the node's text
// with mark-free content, so a comment anchored there loses its mark without
// the writer deleting anything. The thread must stay OPEN (flagged anchorLost
// so persistence keeps it) — never resolved, and so never pushed to the share,
// which has no unresolve.

/** Id of the first node whose text contains `text`. */
async function nodeIdByText(testPage: Page, text: string): Promise<string> {
  const read = await executeProseTool(testPage, 'read_document', {})
  expect(read.success, 'read_document').toBe(true)
  interface DocNode { id: string; content?: string; children?: DocNode[] }
  const flatten = (nodes: DocNode[]): DocNode[] =>
    nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
  const node = flatten((read.data as { nodes: DocNode[] }).nodes).find(
    (n) => (n.content ?? '').includes(text),
  )
  expect(node, `node containing "${text}"`).toBeTruthy()
  return node!.id
}

/** Comment a node and wait for the restore cycle to settle. */
async function commentOn(testPage: Page, nodeId: string, commentText: string): Promise<string> {
  const result = await executeProseTool(testPage, 'add_comment', { nodeId, comment: commentText }, 'editor')
  expect(result.success, `add_comment: ${JSON.stringify(result)}`).toBe(true)
  await testPage.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__prose_tools.getCommentStoreNeedsRestore() === false,
    { timeout: 5_000 },
  )
  expect(await countCommentMarks(testPage)).toBeGreaterThan(0)
  return (result.data as { id: string }).id
}

/** The thread survived the replacement: open, unanchored, still in the store. */
async function expectKeptOpen(testPage: Page, commentId: string): Promise<void> {
  await expect.poll(() => countCommentMarks(testPage)).toBe(0)
  await expect
    .poll(async () => {
      const c = (await getCommentStore(testPage)).find((t) => t.id === commentId)
      return c ? { resolved: c.resolved, anchorLost: c.anchorLost } : null
    }, { message: 'thread kept open and flagged anchorLost' })
    .toEqual({ resolved: false, anchorLost: true })
}

async function suggest(testPage: Page, nodeId: string, content: string): Promise<string> {
  const suggested = await executeProseTool(testPage, 'suggest_edit', { nodeId, content })
  expect(suggested.success, `suggest_edit: ${JSON.stringify(suggested)}`).toBe(true)
  return (suggested.data as { suggestionId: string }).suggestionId
}

test('accepting a suggestion over a comment keeps the thread open (#1099)', async () => {
  await openFreshFile(page, '1099-accept.md', 'The reviewer flagged this sentence for a rewrite.\n')
  const nodeId = await nodeIdByText(page, 'The reviewer flagged')
  const commentId = await commentOn(page, nodeId, 'Tighten this.')

  const id = await suggest(page, nodeId, 'The AI rewrote the flagged sentence.')
  const accepted = await executeProseTool(page, 'accept_diff', { id })
  expect(accepted.success, `accept_diff: ${JSON.stringify(accepted)}`).toBe(true)

  await expectKeptOpen(page, commentId)

  // Undoing the accept brings the anchor back, and the flag goes with it.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__prose_editor.commands.undo()
  })
  await expect.poll(() => countCommentMarks(page)).toBeGreaterThan(0)
  await expect
    .poll(async () => (await getCommentStore(page)).find((t) => t.id === commentId)?.anchorLost)
    .toBe(false)
})

test('accept-all over a comment keeps the thread open (#1099)', async () => {
  await openFreshFile(
    page,
    '1099-accept-all.md',
    'First paragraph carries the comment.\n\nSecond paragraph is plain.\n',
  )
  const firstId = await nodeIdByText(page, 'First paragraph')
  const commentId = await commentOn(page, firstId, 'Reword the opener.')

  await suggest(page, firstId, 'The opener, reworded by the AI.')
  await suggest(page, await nodeIdByText(page, 'Second paragraph'), 'The second, also reworded.')
  const acceptAll = await executeProseTool(page, 'accept_diff', {})
  expect(acceptAll.success, `accept_diff (all): ${JSON.stringify(acceptAll)}`).toBe(true)

  await expectKeptOpen(page, commentId)
})

test('an edit tool write over a comment keeps the thread anchored (#1099)', async () => {
  await openFreshFile(page, '1099-edit.md', 'This commented line gets a direct AI edit.\n')
  const nodeId = await nodeIdByText(page, 'This commented line')
  const commentId = await commentOn(page, nodeId, 'Check this claim.')

  // `edit` inserts its payload as text, which inherits the marks at the
  // selection — so the comment re-covers the new text rather than vanishing.
  // Guard that: if the payload ever goes through the parser (mark-free
  // nodes), the AI_REPLACEMENT_META tag must still keep the thread open.
  const edited = await executeProseTool(page, 'edit', {
    nodeId,
    search: 'This commented line gets a direct AI edit.',
    content: 'The line after a direct AI edit.',
  })
  expect(edited.success, `edit: ${JSON.stringify(edited)}`).toBe(true)

  await expect.poll(() => countCommentMarks(page)).toBeGreaterThan(0)
  const thread = (await getCommentStore(page)).find((t) => t.id === commentId)
  expect(thread?.resolved, 'thread not resolved by an edit').toBe(false)
})
