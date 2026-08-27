/**
 * MCP review collaboration — deterministic lifecycle coverage.
 *
 * This suite deliberately uses the real renderer tool pipeline through
 * window.__prose_tools and never calls an LLM. MCP-originated calls use the
 * trusted execution-context argument so the tests cover the same attribution
 * and allowlist checks used by the application bridge.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getToolsForMCP, isToolExposedViaMCP } from '../src/shared/tools/registry'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  executeProseTool,
  type ProseToolResult,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

const REVIEW_MCP_TOOLS = [
  'list_suggestions',
  'add_suggestion_feedback',
  'revise_suggestion',
  'decide_suggestion',
  'list_review_events',
  'get_review_status',
] as const

const COMMENT_REVIEW_MCP_TOOLS = ['reply_to_comment', 'reopen_comment'] as const

const HIDDEN_MCP_TOOLS = ['edit', 'insert', 'delete_node', 'accept_diff', 'reject_diff'] as const

interface DocNode {
  id: string
  content?: string
  children?: DocNode[]
}

interface ReviewAttribution {
  actor: 'human' | 'assistant' | 'system'
  origin: 'ui' | 'chat' | 'mcp'
  label?: string
  model?: string
  conversationId?: string
  messageId?: string
  requestId?: string
}

interface McpExecutionContext {
  origin: 'mcp'
  requestId: string
  attribution: ReviewAttribution
  expectedDocumentId: string
}

function mcpContext(requestId: string, expectedDocumentId: string): McpExecutionContext {
  return {
    origin: 'mcp',
    requestId,
    expectedDocumentId,
    attribution: {
      actor: 'assistant',
      origin: 'mcp',
      label: 'Claude (MCP)',
      model: 'Claude (MCP)',
      requestId,
    },
  }
}

/** Invoke the real tool pipeline with the trusted MCP execution context. */
async function executeMcpTool(
  testPage: Page,
  toolName: string,
  args: Record<string, unknown>,
  requestId: string,
): Promise<ProseToolResult> {
  const expectedDocumentId = await currentDocumentId(testPage)
  if (!expectedDocumentId) {
    throw new Error(`MCP call ${toolName} has no active document identity`)
  }
  const context = mcpContext(requestId, expectedDocumentId)
  const provenance = {
    model: 'Claude (MCP)',
    conversationId: requestId,
    messageId: requestId,
    documentId: expectedDocumentId,
  }
  return testPage.evaluate(
    async ({ name, toolArgs, toolProvenance, toolContext }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__prose_tools.executeTool(
        name,
        toolArgs,
        'create',
        toolProvenance,
        toolContext,
      )
    },
    { name: toolName, toolArgs: args, toolProvenance: provenance, toolContext: context },
  )
}

async function currentDocumentId(testPage: Page): Promise<string | null> {
  return testPage.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__prose_tools.getCommentDocId() as string | null
  })
}

async function openFreshFile(testPage: Page, name: string, content: string): Promise<string> {
  // Review panels hold focus in the sidebar; close one before changing the
  // active document so the next test starts from the normal editor surface.
  const closeReview = testPage.locator('[aria-label^="Close review"]').first()
  if (await closeReview.isVisible({ timeout: 500 }).catch(() => false)) {
    await closeReview.click()
  }

  const filePath = join(qaDocsDir, name)
  writeFileSync(filePath, content)
  const opened = await executeProseTool(testPage, 'open_file', { path: filePath })
  expect(opened.success, `open_file ${name}: ${JSON.stringify(opened)}`).toBe(true)
  await waitForEditor(testPage)
  await expect.poll(() => currentDocumentId(testPage), { timeout: 5_000 }).toBeTruthy()
  return filePath
}

async function nodeIdByText(testPage: Page, text: string): Promise<string> {
  const result = await executeProseTool(testPage, 'read_document', {})
  expect(result.success, `read_document: ${JSON.stringify(result)}`).toBe(true)

  const flatten = (nodes: DocNode[]): DocNode[] =>
    nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])])
  const match = flatten((result.data as { nodes: DocNode[] }).nodes).find((node) =>
    (node.content ?? '').includes(text),
  )
  expect(match, `node containing "${text}"`).toBeTruthy()
  return match!.id
}

async function createSuggestion(
  testPage: Page,
  targetText: string,
  suggestedText: string,
  explanation: string,
  requestId: string,
): Promise<string> {
  const nodeId = await nodeIdByText(testPage, targetText)
  const result = await executeMcpTool(
    testPage,
    'suggest_edit',
    { nodeId, content: suggestedText, comment: explanation },
    requestId,
  )
  expect(result.success, `suggest_edit: ${JSON.stringify(result)}`).toBe(true)
  return (result.data as { suggestionId: string }).suggestionId
}

async function listSuggestions(
  testPage: Page,
  status: 'pending' | 'accepted' | 'rejected' | 'superseded' | 'all' = 'all',
  requestId = `list-${status}`,
): Promise<Array<Record<string, any>>> {
  const result = await executeMcpTool(testPage, 'list_suggestions', { status, includeFeedback: true }, requestId)
  expect(result.success, `list_suggestions: ${JSON.stringify(result)}`).toBe(true)
  return (result.data as { suggestions: Array<Record<string, any>> }).suggestions
}

async function listEvents(
  testPage: Page,
  targetType?: 'comment' | 'suggestion',
  requestId = `events-${targetType ?? 'all'}`,
): Promise<Array<Record<string, any>>> {
  const result = await executeMcpTool(
    testPage,
    'list_review_events',
    targetType ? { targetType } : {},
    requestId,
  )
  expect(result.success, `list_review_events: ${JSON.stringify(result)}`).toBe(true)
  return (result.data as { events: Array<Record<string, any>> }).events
}

test.beforeAll(async () => {
  test.setTimeout(60_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-mcp-review-profile-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-mcp-review-docs-'))

  const launched = await launchApp({
    env: {
      PROSE_USER_DATA_DIR: qaUserDataDir,
      PROSE_DOCS_DIR: qaDocsDir,
      PROSE_REMOTE_DEBUGGING_PORT: '0',
    },
  })
  app = launched.app
  page = launched.page

  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

test('MCP exposes review tools and rejects hidden document mutations', async () => {
  const exposedNames = getToolsForMCP().map((tool) => tool.name)

  expect(exposedNames).toEqual(expect.arrayContaining([...REVIEW_MCP_TOOLS, ...COMMENT_REVIEW_MCP_TOOLS]))
  expect(exposedNames).not.toEqual(expect.arrayContaining([...HIDDEN_MCP_TOOLS]))
  for (const name of [...REVIEW_MCP_TOOLS, ...COMMENT_REVIEW_MCP_TOOLS]) {
    expect(isToolExposedViaMCP(name)).toBe(true)
  }
  for (const name of HIDDEN_MCP_TOOLS) {
    expect(isToolExposedViaMCP(name)).toBe(false)
  }

  await openFreshFile(page, 'registry-test.md', '# Registry Test\n\nA sentence for the registry test.\n')
  const hidden = await executeMcpTool(page, 'edit', {}, 'hidden-edit')
  expect(hidden).toMatchObject({ success: false, code: 'MCP_TOOL_NOT_EXPOSED' })
})

test('suggestions expose rationale and attribution; Quick Review feedback is visible and durable', async () => {
  const filePath = await openFreshFile(
    page,
    'feedback-test.md',
    '# Feedback Test\n\nThe original sentence needs a careful revision.\n',
  )
  const suggestionId = await createSuggestion(
    page,
    'The original sentence needs a careful revision.',
    'The revised sentence needs a careful revision.',
    'Clarify the claim before publication.',
    'mcp-feedback-create',
  )

  const created = (await listSuggestions(page, 'pending', 'mcp-feedback-list'))
    .find((suggestion) => suggestion.id === suggestionId)
  expect(created).toBeTruthy()
  expect(created).toMatchObject({
    id: suggestionId,
    status: 'pending',
    explanation: 'Clarify the claim before publication.',
    attribution: {
      actor: 'assistant',
      origin: 'mcp',
      model: 'Claude (MCP)',
      conversationId: 'mcp-feedback-create',
      messageId: 'mcp-feedback-create',
    },
  })

  await expect(page.getByRole('button', { name: /1 suggestion/ }).first()).toBeVisible()
  await page.getByRole('button', { name: /1 suggestion/ }).first().click()
  // The heading sits inside the title row; the panel root is three parents up
  // (panel -> header row -> title row -> heading).
  const reviewPanel = page.getByRole('heading', { name: 'Quick Review' }).locator('xpath=../../..')
  await expect(reviewPanel).toBeVisible()
  await expect(reviewPanel.getByTestId('suggestion-attribution')).toHaveText('Claude (MCP)')
  await expect(reviewPanel).toContainText('Clarify the claim before publication.')
  await page.getByRole('button', { name: 'Add feedback' }).click()
  const feedbackBox = page.locator('textarea[placeholder="Tell the AI what to change..."]')
  await feedbackBox.fill('Preserve the cautious tone.')
  await reviewPanel.getByRole('button', { name: 'Submit' }).click()
  await expect(reviewPanel).toContainText('Preserve the cautious tone.')

  const feedback = await executeMcpTool(
    page,
    'add_suggestion_feedback',
    { id: suggestionId, text: 'Keep the qualification explicit.' },
    'mcp-feedback-add',
  )
  expect(feedback).toMatchObject({ success: true })
  expect((feedback.data as { suggestionId: string; feedbackId: string; eventId: string })).toMatchObject({
    suggestionId,
  })

  const afterFeedback = (await listSuggestions(page, 'pending', 'mcp-feedback-after'))
    .find((suggestion) => suggestion.id === suggestionId)
  expect(afterFeedback?.userReply).toBe('Keep the qualification explicit.')
  expect(afterFeedback?.feedback).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: 'Preserve the cautious tone.', author: 'user' }),
    expect.objectContaining({
      text: 'Keep the qualification explicit.',
      author: 'ai',
      attribution: expect.objectContaining({ origin: 'mcp', model: 'Claude (MCP)' }),
    }),
  ]))

  // Re-open the file to prove that feedback is history, not only an in-memory
  // mark attribute. The review panel is closed before the tab operation.
  await page.locator('[aria-label^="Close review"]').first().click()
  await page.keyboard.press('Control+w')
  await waitForEditor(page)
  const reopened = await executeProseTool(page, 'open_file', { path: filePath })
  expect(reopened.success).toBe(true)
  await waitForEditor(page)
  const persisted = (await listSuggestions(page, 'pending', 'mcp-feedback-persisted'))
    .find((suggestion) => suggestion.id === suggestionId)
  expect(persisted?.feedback).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: 'Preserve the cautious tone.' }),
    expect.objectContaining({ text: 'Keep the qualification explicit.' }),
  ]))
})

test('decide_suggestion accepts and rejects explicit IDs with durable status/events', async () => {
  await openFreshFile(
    page,
    'decisions-test.md',
    '# Decisions Test\n\nThe first sentence is ready for acceptance.\n\nThe second sentence should remain unchanged.\n',
  )
  const acceptedId = await createSuggestion(
    page,
    'The first sentence is ready for acceptance.',
    'The first sentence is ready for publication.',
    'Tighten the publication wording.',
    'mcp-accept-create',
  )
  const rejectedId = await createSuggestion(
    page,
    'The second sentence should remain unchanged.',
    'The second sentence should be rewritten.',
    'This change is intentionally rejected.',
    'mcp-reject-create',
  )

  const accepted = await executeMcpTool(
    page,
    'decide_suggestion',
    { id: acceptedId, decision: 'accept' },
    'mcp-accept-decision',
  )
  const rejected = await executeMcpTool(
    page,
    'decide_suggestion',
    { id: rejectedId, decision: 'reject' },
    'mcp-reject-decision',
  )
  expect(accepted).toMatchObject({ success: true, data: { suggestionId: acceptedId, status: 'accepted' } })
  expect(rejected).toMatchObject({ success: true, data: { suggestionId: rejectedId, status: 'rejected' } })
  expect((accepted.data as { eventId: string }).eventId).toBeTruthy()
  expect((rejected.data as { eventId: string }).eventId).toBeTruthy()

  // An accepted durable decision must be immediately reflected in the
  // document read, even before the editor's debounced store update runs.
  const afterDecisions = await executeProseTool(page, 'read_document', {})
  expect(afterDecisions.success, `read_document: ${JSON.stringify(afterDecisions)}`).toBe(true)
  const afterDecisionMarkdown = (afterDecisions.data as { markdown: string }).markdown
  expect(afterDecisionMarkdown).toContain('The first sentence is ready for publication.')
  expect(afterDecisionMarkdown).not.toContain('The first sentence is ready for acceptance.')

  const all = await listSuggestions(page, 'all', 'mcp-decisions-all')
  expect(all).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: acceptedId, status: 'accepted' }),
    expect.objectContaining({ id: rejectedId, status: 'rejected' }),
  ]))
  const events = await listEvents(page, 'suggestion', 'mcp-decisions-events')
  const acceptedEvents = events.filter((event) => event.targetId === acceptedId && event.eventType === 'suggestion_decided')
  const rejectedEvents = events.filter((event) => event.targetId === rejectedId && event.eventType === 'suggestion_decided')
  expect(acceptedEvents).toHaveLength(1)
  expect(rejectedEvents).toHaveLength(1)
  expect(acceptedEvents[0].id).toBe((accepted.data as { eventId: string }).eventId)
  expect(rejectedEvents[0].id).toBe((rejected.data as { eventId: string }).eventId)
  expect(acceptedEvents[0].attribution).toMatchObject({ origin: 'mcp', model: 'Claude (MCP)' })
  expect(rejectedEvents[0].attribution).toMatchObject({ origin: 'mcp', model: 'Claude (MCP)' })

  // The terminal records and events survive a document reload.
  await page.keyboard.press('Control+w')
  await waitForEditor(page)
  const reopened = await executeProseTool(page, 'open_file', { path: join(qaDocsDir, 'decisions-test.md') })
  expect(reopened.success).toBe(true)
  await waitForEditor(page)
  const afterReload = await listSuggestions(page, 'all', 'mcp-decisions-reload')
  expect(afterReload).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: acceptedId, status: 'accepted' }),
    expect.objectContaining({ id: rejectedId, status: 'rejected' }),
  ]))
})

test('revise_suggestion links predecessor and replacement with one revision event', async () => {
  await openFreshFile(
    page,
    'revision-test.md',
    '# Revision Test\n\nThis sentence needs a first pass.\n',
  )
  const predecessorId = await createSuggestion(
    page,
    'This sentence needs a first pass.',
    'This sentence needs a careful first pass.',
    'Add a qualification before revising again.',
    'mcp-revision-create',
  )

  const revised = await executeMcpTool(
    page,
    'revise_suggestion',
    {
      id: predecessorId,
      content: 'This sentence needs a carefully qualified first pass.',
      comment: 'The revised wording keeps the qualification explicit.',
    },
    'mcp-revision-revise',
  )
  expect(revised).toMatchObject({
    success: true,
    data: { supersedesId: predecessorId, status: 'pending', suggested: true },
  })
  const replacementId = (revised.data as { suggestionId: string }).suggestionId
  const revisionEventId = (revised.data as { eventId: string }).eventId
  expect(replacementId).toBeTruthy()
  expect(replacementId).not.toBe(predecessorId)
  expect(revisionEventId).toBeTruthy()

  const all = await listSuggestions(page, 'all', 'mcp-revision-all')
  expect(all).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: predecessorId,
      status: 'superseded',
      supersededById: replacementId,
    }),
    expect.objectContaining({
      id: replacementId,
      status: 'pending',
      supersedesId: predecessorId,
      explanation: 'The revised wording keeps the qualification explicit.',
    }),
  ]))

  const events = await listEvents(page, 'suggestion', 'mcp-revision-events')
  expect(events.filter((event) => event.eventType === 'suggestion_created')).toHaveLength(2)
  const revisionEvents = events.filter((event) => event.eventType === 'suggestion_revised')
  expect(revisionEvents).toHaveLength(1)
  expect(revisionEvents[0]).toMatchObject({
    id: revisionEventId,
    targetId: predecessorId,
    metadata: { replacementId },
    attribution: { origin: 'mcp', model: 'Claude (MCP)' },
  })
  expect(new Set(events.map((event) => event.id)).size).toBe(events.length)
})

test('comment reply and reopen preserve the thread and emit one event each', async () => {
  await openFreshFile(
    page,
    'comment-lifecycle-test.md',
    '# Comment Lifecycle Test\n\nA sentence that needs an editorial comment.\n',
  )
  const nodeId = await nodeIdByText(page, 'A sentence that needs an editorial comment.')
  const added = await executeMcpTool(
    page,
    'add_comment',
    { nodeId, comment: 'Please check the rhythm before publication.' },
    'mcp-comment-add',
  )
  expect(added).toMatchObject({ success: true })
  const commentId = (added.data as { id: string; eventId: string }).id
  const createdEventId = (added.data as { eventId: string }).eventId

  const replied = await executeMcpTool(
    page,
    'reply_to_comment',
    { id: commentId, text: 'The rhythm now scans cleanly.' },
    'mcp-comment-reply',
  )
  expect(replied).toMatchObject({ success: true, data: { commentId, documentId: expect.any(String) } })
  const replyEventId = (replied.data as { eventId: string }).eventId

  const resolved = await executeMcpTool(
    page,
    'resolve_comment',
    { id: commentId },
    'mcp-comment-resolve',
  )
  expect(resolved).toMatchObject({ success: true, data: { id: commentId, resolved: true } })
  const resolvedEventId = (resolved.data as { eventId: string }).eventId

  const reopened = await executeMcpTool(
    page,
    'reopen_comment',
    { id: commentId },
    'mcp-comment-reopen',
  )
  expect(reopened).toMatchObject({ success: true, data: { id: commentId, reopened: true } })
  const reopenedEventId = (reopened.data as { eventId: string }).eventId
  expect(new Set([createdEventId, replyEventId, resolvedEventId, reopenedEventId]).size).toBe(4)

  const listed = await executeMcpTool(page, 'list_comments', {}, 'mcp-comment-list')
  expect(listed.success).toBe(true)
  const comment = (listed.data as { comments: Array<Record<string, any>> }).comments
    .find((entry) => entry.id === commentId)
  expect(comment).toMatchObject({
    id: commentId,
    resolved: false,
    status: 'open',
    author: 'ai',
    attribution: { actor: 'assistant', origin: 'mcp', model: 'Claude (MCP)' },
  })
  expect(comment?.replies).toEqual([
    expect.objectContaining({
      author: 'ai',
      text: 'The rhythm now scans cleanly.',
      attribution: expect.objectContaining({ actor: 'assistant', origin: 'mcp', model: 'Claude (MCP)' }),
    }),
  ])

  const events = await listEvents(page, 'comment', 'mcp-comment-events')
  expect(events.filter((event) => event.targetId === commentId && event.eventType === 'comment_created')).toHaveLength(1)
  expect(events.filter((event) => event.targetId === commentId && event.eventType === 'comment_replied')).toHaveLength(1)
  expect(events.filter((event) => event.targetId === commentId && event.eventType === 'comment_resolved')).toHaveLength(1)
  expect(events.filter((event) => event.targetId === commentId && event.eventType === 'comment_reopened')).toHaveLength(1)
  expect(events.find((event) => event.id === replyEventId)?.attribution).toMatchObject({ origin: 'mcp' })
})

test('review status and event filters keep comment and suggestion domains separate', async () => {
  await openFreshFile(
    page,
    'status-separation-test.md',
    '# Status Separation Test\n\nA sentence for a suggestion.\n\nA sentence for a comment.\n',
  )
  const suggestionId = await createSuggestion(
    page,
    'A sentence for a suggestion.',
    'A revised sentence for a suggestion.',
    'Rationale for the suggestion.',
    'mcp-separation-suggestion',
  )
  const commentNodeId = await nodeIdByText(page, 'A sentence for a comment.')
  const commentResult = await executeMcpTool(
    page,
    'add_comment',
    { nodeId: commentNodeId, comment: 'A separate comment thread.' },
    'mcp-separation-comment',
  )
  expect(commentResult.success).toBe(true)
  const commentId = (commentResult.data as { id: string }).id

  const statusResult = await executeMcpTool(page, 'get_review_status', {}, 'mcp-separation-status')
  expect(statusResult.success).toBe(true)
  expect(statusResult.data).toMatchObject({
    comments: { total: 1, open: 1, resolved: 0, withReplies: 0 },
    suggestions: { pending: 1, withFeedback: 0, accepted: 0, rejected: 0, superseded: 0 },
  })

  const commentEvents = await listEvents(page, 'comment', 'mcp-separation-comment-events')
  const suggestionEvents = await listEvents(page, 'suggestion', 'mcp-separation-suggestion-events')
  expect(commentEvents.length).toBeGreaterThan(0)
  expect(suggestionEvents.length).toBeGreaterThan(0)
  expect(commentEvents.every((event) => event.targetType === 'comment' && event.targetId === commentId)).toBe(true)
  expect(suggestionEvents.every((event) => event.targetType === 'suggestion' && event.targetId === suggestionId)).toBe(true)
  expect(commentEvents.some((event) => event.targetId === suggestionId)).toBe(false)
  expect(suggestionEvents.some((event) => event.targetId === commentId)).toBe(false)
})
