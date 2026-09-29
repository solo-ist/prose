/**
 * Regression tests for #933: auto-resolving the last comment when its text is deleted.
 *
 * Tests:
 * 1. Deleting the text of the sole remaining comment resolves the thread (#933 fix).
 * 2. Toggling source mode with one open comment does NOT resolve it (invariant guard).
 *
 * Both tests use a fresh markdown file per case, a single comment added via the
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

  // Give the plugin view update cycle one tick to fire
  await page.waitForTimeout(50)

  // The mark must be gone from the DOM
  expect(await countCommentMarks(page)).toBe(0)

  // The thread must be resolved in the store
  const comments = await getCommentStore(page)
  const thread = comments.find((c) => c.id === commentId)
  expect(thread, 'thread exists in store').toBeTruthy()
  expect(thread!.resolved, 'thread is resolved').toBe(true)
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
