/**
 * Comment threading (#699) — replies, real resolved state, AI participation.
 *
 * Tests:
 * 1. reply_to_comment tool appends an AI reply to the persisted thread.
 * 2. resolve_comment sets resolved:true in the store instead of deleting the record.
 * 3. list_comments returns replies + resolved state.
 * 4. Resolved threads are not re-marked on restoreComments.
 *
 * Each test opens a fresh markdown file for isolation. No tab sharing.
 * No LLM calls — all tools invoked via window.__prose_tools.executeTool.
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
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

test.beforeAll(async () => {
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-699-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-699-docs-'))

  const result = await launchApp({
    env: {
      PROSE_USER_DATA_DIR: qaUserDataDir,
      PROSE_DOCS_DIR: qaDocsDir,
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
 * Open a fresh markdown file (creates + writes it) and wait for the editor.
 * Returns the file path.
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
 * Find any non-empty paragraph node and add a comment to it.
 * Returns the new comment ID.
 */
async function addComment(testPage: Page, commentText: string): Promise<string> {
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

test('reply_to_comment appends AI reply to thread', async () => {
  await openFreshFile(page, 'reply-test.md', '# Reply Test\n\nThe quick brown fox jumps over the lazy dog.\n')

  const commentId = await addComment(page, 'Check the rhythm of this sentence.')

  const replyResult = await executeProseTool(page, 'reply_to_comment', {
    id: commentId,
    text: 'The rhythm is fine — the stress pattern scans well.',
  }, 'editor')
  expect(replyResult.success, `reply_to_comment: ${JSON.stringify(replyResult)}`).toBe(true)
  const replyId = (replyResult.data as { replyId: string }).replyId
  expect(typeof replyId).toBe('string')
  expect(replyId.length).toBeGreaterThan(0)

  // Verify the reply landed in the comment store
  const comments = await getCommentStore(page)
  const thread = comments.find((c) => c.id === commentId)
  expect(thread, 'thread in store').toBeTruthy()
  const replies = thread!.replies as Array<{ id: string; author: string; text: string }>
  expect(replies).toHaveLength(1)
  expect(replies[0].author).toBe('ai')
  expect(replies[0].text).toContain('rhythm is fine')
  expect(replies[0].id).toBe(replyId)
})

test('resolve_comment sets resolved:true and removes mark', async () => {
  await openFreshFile(page, 'resolve-test.md', '# Resolve Test\n\nA sentence to comment on for resolve testing.\n')

  const commentId = await addComment(page, 'Resolve this thread.')

  // Mark should be present before resolve
  const marksBefore = await countCommentMarks(page)
  expect(marksBefore).toBeGreaterThan(0)

  const resolveResult = await executeProseTool(page, 'resolve_comment', {
    id: commentId,
  }, 'editor')
  expect(resolveResult.success, `resolve_comment: ${JSON.stringify(resolveResult)}`).toBe(true)

  // Mark should be gone from the editor
  const marksAfter = await countCommentMarks(page)
  expect(marksAfter).toBe(0)

  // Thread must persist in the store with resolved:true
  const comments = await getCommentStore(page)
  const thread = comments.find((c) => c.id === commentId)
  expect(thread, 'thread persists after resolve').toBeTruthy()
  expect(thread!.resolved).toBe(true)
})

test('list_comments includes replies and resolved state', async () => {
  await openFreshFile(page, 'list-test.md', '# List Test\n\nContent for list_comments threading test.\n')

  const commentId = await addComment(page, 'List comments should show replies.')

  await executeProseTool(page, 'reply_to_comment', {
    id: commentId,
    text: 'Acknowledged.',
  }, 'editor')

  const listResult = await executeProseTool(page, 'list_comments', {})
  expect(listResult.success).toBe(true)
  const listData = listResult.data as {
    comments: Array<{ id: string; replies: unknown[]; resolved: boolean }>
  }
  const entry = listData.comments.find((c) => c.id === commentId)
  expect(entry, 'comment in list').toBeTruthy()
  expect(entry!.replies).toHaveLength(1)
  expect(entry!.resolved).toBe(false)
})

test('resolved threads do not get re-marked on restoreComments', async () => {
  // Write the initial file
  const mdPath = await openFreshFile(
    page,
    'resolve-restore-test.md',
    '# Restore Test\n\nThis text will be commented then the thread resolved.\n'
  )

  const commentId = await addComment(page, 'Should not re-appear after resolve.')

  // Resolve the comment (sets resolved:true, removes mark, persists to IDB)
  const resolveResult = await executeProseTool(page, 'resolve_comment', { id: commentId }, 'editor')
  expect(resolveResult.success, 'resolve_comment').toBe(true)

  // Confirm no mark in editor right now
  expect(await countCommentMarks(page)).toBe(0)

  // Close this tab (triggers save) then reopen the file to trigger restoreComments
  await page.keyboard.press('Control+w')
  await waitForEditor(page)

  const reopen = await executeProseTool(page, 'open_file', { path: mdPath })
  expect(reopen.success, 'open_file reopen').toBe(true)
  await waitForEditor(page)

  // restoreComments must skip the resolved thread — no mark in the editor
  const marksAfterReopen = await countCommentMarks(page)
  expect(marksAfterReopen).toBe(0)
})

test('add_comment on an already-commented node blocks instead of clobbering (#830)', async () => {
  await openFreshFile(
    page,
    'clobber-test.md',
    '# Clobber Test\n\nOverlapping comments on this paragraph must not destroy each other.\n'
  )

  const firstId = await addComment(page, 'first thread — must survive')

  // Target the same node the helper picked: nodeId resolves to the whole node
  // range, so this second add_comment is an exactly-equal range — the clobber
  // case. It must be refused with COMMENT_EXISTS naming the existing thread.
  const read = await executeProseTool(page, 'read_document', {})
  interface DocNode { id: string; content?: string; children?: DocNode[] }
  const flatten = (nodes: DocNode[]): DocNode[] =>
    nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
  const node = flatten((read.data as { nodes: DocNode[] }).nodes).find(
    (n) => n.content && n.content.trim().length > 5,
  )
  const second = await executeProseTool(page, 'add_comment', {
    nodeId: node!.id,
    comment: 'second thread — must be blocked',
  }, 'editor')
  expect(second.success, 'overlapping add_comment must be refused').toBe(false)
  expect((second as { code?: string }).code).toBe('COMMENT_EXISTS')
  expect((second as { error?: string }).error).toContain(firstId)

  // The original thread is intact on both surfaces: exactly one store entry
  // and its mark still lives in the doc (store and doc must not diverge).
  const threads = (await getCommentStore(page)).filter((c) => !c.resolved)
  expect(threads).toHaveLength(1)
  expect(threads[0].id).toBe(firstId)
  expect(await countCommentMarks(page)).toBeGreaterThan(0)
})
