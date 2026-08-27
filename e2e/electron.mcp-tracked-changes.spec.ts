/**
 * MCP tracked-change coverage. These tests exercise the renderer tool bridge
 * with trusted MCP context and assert both the document-facing marks and the
 * durable Quick Review lifecycle.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
let userDataDir: string
let docsDir: string

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

function mcpContext(requestId: string, documentId: string): McpExecutionContext {
  return {
    origin: 'mcp',
    requestId,
    expectedDocumentId: documentId,
    attribution: {
      actor: 'assistant',
      origin: 'mcp',
      label: 'Codex (MCP)',
      model: 'Codex (MCP)',
      requestId,
    },
  }
}

async function documentId(testPage: Page): Promise<string> {
  const id = await testPage.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__prose_tools.getCommentDocId() as string | null
  })
  expect(id).toBeTruthy()
  return id!
}

async function mcpTool(
  testPage: Page,
  name: string,
  args: Record<string, unknown>,
  requestId: string,
): Promise<ProseToolResult> {
  const expectedDocumentId = await documentId(testPage)
  return testPage.evaluate(
    async ({ toolName, toolArgs, toolProvenance, toolContext }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__prose_tools.executeTool(
        toolName,
        toolArgs,
        'create',
        toolProvenance,
        toolContext,
      )
    },
    {
      toolName: name,
      toolArgs: args,
      toolProvenance: {
        model: 'Codex (MCP)',
        conversationId: requestId,
        messageId: requestId,
        documentId: expectedDocumentId,
      },
      toolContext: mcpContext(requestId, expectedDocumentId),
    },
  )
}

async function openFixture(testPage: Page, name: string, content: string): Promise<void> {
  const path = join(docsDir, name)
  writeFileSync(path, content)
  const opened = await executeProseTool(testPage, 'open_file', { path })
  expect(opened.success, JSON.stringify(opened)).toBe(true)
  await waitForEditor(testPage)
}

async function nodeIdByText(testPage: Page, text: string): Promise<string> {
  const result = await executeProseTool(testPage, 'read_document', {})
  expect(result.success, JSON.stringify(result)).toBe(true)
  const flatten = (nodes: DocNode[]): DocNode[] =>
    nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])])
  const match = flatten((result.data as { nodes: DocNode[] }).nodes).find((node) =>
    (node.content ?? '').includes(text),
  )
  expect(match, `node containing ${text}`).toBeTruthy()
  return match!.id
}

async function markSnapshot(testPage: Page): Promise<{
  text: string
  marks: Array<{ type: string; id: string }>
}> {
  return testPage.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    const marks: Array<{ type: string; id: string }> = []
    editor.state.doc.descendants((node: any) => {
      for (const mark of node.marks ?? []) {
        if (mark.type.name === 'aiSuggestion') {
          marks.push({ type: mark.attrs.type, id: mark.attrs.id })
        }
      }
    })
    return { text: editor.state.doc.textContent, marks }
  })
}

test.beforeAll(async () => {
  test.setTimeout(60_000)
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-mcp-tracked-profile-'))
  docsDir = mkdtempSync(join(tmpdir(), 'prose-mcp-tracked-docs-'))
  const launched = await launchApp({
    env: {
      PROSE_USER_DATA_DIR: userDataDir,
      PROSE_DOCS_DIR: docsDir,
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
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(docsDir, { recursive: true, force: true })
})

test('insert_after creates a genuine multi-paragraph suggestion with Codex attribution', async () => {
  await openFixture(
    page,
    'insert-after.md',
    '# Test\n\nAnchor paragraph stays unchanged.\n\nTail paragraph remains below.\n',
  )
  const anchorId = await nodeIdByText(page, 'Anchor paragraph stays unchanged.')
  const created = await mcpTool(
    page,
    'insert_after',
    {
      nodeId: anchorId,
      content: 'First proposed paragraph.\n\nSecond proposed paragraph.',
      comment: 'Add the missing transition.',
    },
    'tracked-insertion-create',
  )
  expect(created).toMatchObject({ success: true, data: { suggested: true, nodeId: anchorId } })
  const suggestionId = (created.data as { suggestionId: string }).suggestionId

  const pending = await mcpTool(page, 'list_suggestions', { status: 'pending' }, 'tracked-insertion-list')
  expect(pending).toMatchObject({ success: true })
  const pendingSuggestions = (pending.data as { suggestions: Array<Record<string, unknown>> }).suggestions
  expect(pendingSuggestions).toHaveLength(1)
  expect(pendingSuggestions[0]).toMatchObject({
    id: suggestionId,
    type: 'insertion',
    explanation: 'Add the missing transition.',
    attribution: { origin: 'mcp', model: 'Codex (MCP)' },
  })

  const snapshot = await markSnapshot(page)
  expect(snapshot.text).toContain('Anchor paragraph stays unchanged.')
  expect(snapshot.text).toContain('First proposed paragraph.')
  expect(snapshot.text).toContain('Second proposed paragraph.')
  expect(snapshot.marks.filter((mark) => mark.id === suggestionId)).toHaveLength(2)

  // The MCP call must persist its active marks before returning. Reloading
  // immediately afterwards should restore the candidate blocks and their
  // insertion marks from the durable pending-suggestions snapshot.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  const reopened = await executeProseTool(page, 'open_file', {
    path: join(docsDir, 'insert-after.md'),
  })
  expect(reopened.success, JSON.stringify(reopened)).toBe(true)
  await waitForEditor(page)
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean((window as any).__prose_tools?.executeTool)
  })
  await expect.poll(async () => (await markSnapshot(page)).text, { timeout: 5_000 })
    .toContain('First proposed paragraph.')
  const restored = await markSnapshot(page)
  expect(restored.text).toContain('First proposed paragraph.')
  expect(restored.text).toContain('Second proposed paragraph.')
  expect(restored.marks.filter((mark) => mark.id === suggestionId)).toHaveLength(2)
  const pendingAfterReload = await mcpTool(page, 'list_suggestions', { status: 'pending' }, 'tracked-insertion-list-after-reload')
  expect((pendingAfterReload.data as { suggestions: Array<Record<string, unknown>> }).suggestions)
    .toEqual(expect.arrayContaining([expect.objectContaining({ id: suggestionId, type: 'insertion' })]))

  const reviewButton = page.getByRole('button', { name: /1 suggestion/ }).first()
  await expect(reviewButton).toBeVisible()
  await reviewButton.click()
  await expect(page.getByTestId('suggestion-type-insertion')).toHaveText('INSERTION')
  await page.getByRole('button', { name: /Close review/ }).click()
  await page.getByRole('button', { name: 'Show chat' }).click()
  await page.getByRole('tab', { name: /Activity/ }).click()
  await expect(page.getByTestId(`suggestion-activity-${suggestionId}`)).toBeVisible()

  const rejected = await mcpTool(
    page,
    'decide_suggestion',
    { id: suggestionId, decision: 'reject' },
    'tracked-insertion-reject',
  )
  expect(rejected).toMatchObject({
    success: true,
    data: { suggestionId, status: 'rejected' },
  })
  const afterReject = await markSnapshot(page)
  expect(afterReject.text).toContain('Anchor paragraph stays unchanged.')
  expect(afterReject.text).toContain('Tail paragraph remains below.')
  expect(afterReject.text).not.toContain('First proposed paragraph.')
  expect(afterReject.text).not.toContain('Second proposed paragraph.')
})

test('suggest_delete keeps original text pending, then accepts or rejects cleanly', async () => {
  await openFixture(
    page,
    'suggest-delete.md',
    '# Delete Test\n\nKeep this paragraph.\n\nRemove this paragraph.\n',
  )
  const targetId = await nodeIdByText(page, 'Remove this paragraph.')
  const created = await mcpTool(
    page,
    'suggest_delete',
    { nodeId: targetId, comment: 'Remove the redundant paragraph.' },
    'tracked-deletion-create',
  )
  expect(created).toMatchObject({ success: true, data: { suggested: true } })
  const suggestionId = (created.data as { suggestionId: string }).suggestionId
  const pendingSnapshot = await markSnapshot(page)
  expect(pendingSnapshot.text).toContain('Remove this paragraph.')
  expect(pendingSnapshot.marks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: suggestionId, type: 'deletion' }),
  ]))

  const rejected = await mcpTool(
    page,
    'decide_suggestion',
    { id: suggestionId, decision: 'reject' },
    'tracked-deletion-reject',
  )
  expect(rejected).toMatchObject({ success: true, data: { status: 'rejected' } })
  expect((await markSnapshot(page)).text).toContain('Remove this paragraph.')

  const acceptedSuggestion = await mcpTool(
    page,
    'suggest_delete',
    { nodeId: targetId, comment: 'Remove it after all.' },
    'tracked-deletion-create-2',
  )
  expect(acceptedSuggestion.success).toBe(true)
  const acceptedId = (acceptedSuggestion.data as { suggestionId: string }).suggestionId
  const accepted = await mcpTool(
    page,
    'decide_suggestion',
    { id: acceptedId, decision: 'accept' },
    'tracked-deletion-accept',
  )
  expect(accepted).toMatchObject({ success: true, data: { status: 'accepted' } })
  const afterAccept = await markSnapshot(page)
  expect(afterAccept.text).toContain('Keep this paragraph.')
  expect(afterAccept.text).not.toContain('Remove this paragraph.')
})

test('review display modes hide and reveal markup without changing pending review state', async () => {
  await openFixture(
    page,
    'review-display.md',
    '# Display Test\n\nOriginal wording for replacement.\n\nAnchor for insertion.\n\nParagraph to remove.\n',
  )
  const replacementId = await nodeIdByText(page, 'Original wording for replacement.')
  const insertionAnchorId = await nodeIdByText(page, 'Anchor for insertion.')
  const deletionId = await nodeIdByText(page, 'Paragraph to remove.')
  const replacement = await mcpTool(
    page,
    'suggest_edit',
    { nodeId: replacementId, content: 'Proposed replacement wording.', comment: 'Clarify the opening.' },
    'tracked-display-replacement',
  )
  const insertion = await mcpTool(
    page,
    'insert_after',
    { nodeId: insertionAnchorId, content: 'Inserted proposed wording.', comment: 'Add detail.' },
    'tracked-display-insertion',
  )
  const deletion = await mcpTool(
    page,
    'suggest_delete',
    { nodeId: deletionId, comment: 'Trim repetition.' },
    'tracked-display-deletion',
  )
  expect(replacement.success && insertion.success && deletion.success).toBe(true)

  const pendingBefore = await mcpTool(page, 'list_suggestions', { status: 'pending' }, 'tracked-display-before')
  const pendingCount = (pendingBefore.data as { suggestions: unknown[] }).suggestions.length
  expect(pendingCount).toBe(3)

  const control = page.getByTestId('review-display-control')
  await expect(control).toHaveAttribute('aria-label', 'Review display: All changes')
  const root = page.locator('.prose-editor').first()
  await expect(root).toHaveClass(/review-display-all/)
  await expect(page.locator('.ai-suggestion-proposal').first()).toBeVisible()
  await expect(page.locator('.ai-suggestion-mark[data-ai-suggestion-type="deletion"]').first()).toBeVisible()

  async function chooseMode(label: string, mode: string): Promise<void> {
    await control.click()
    // Selecting the radio item with the keyboard avoids racing Radix's portal
    // open animation while still exercising the real menu interaction.
    const item = page.getByTestId(`review-display-mode-${mode}`)
    await expect(item).toBeVisible()
    await item.focus()
    await item.press('Enter')
    await expect(control).toHaveAttribute('aria-label', `Review display: ${label}`)
    await expect(root).toHaveClass(new RegExp(`review-display-${mode}`))
    // Let the Radix portal finish its close animation before reopening it for
    // the next mode; this keeps the test deterministic across Electron frames.
    await page.waitForTimeout(200)
  }

  await chooseMode('Insertions highlighted', 'insertions')
  await expect(page.locator('.ai-suggestion-mark[data-ai-suggestion-type="deletion"]').first()).toBeHidden()
  await expect(page.locator('.ai-suggestion-proposal').first()).toBeVisible()

  await chooseMode('Simple markup', 'simple')
  await expect(page.locator('.ai-suggestion-mark[data-ai-suggestion-type="deletion"]').first()).toBeHidden()
  await expect(page.locator('.ai-suggestion-proposal').first()).toBeVisible()

  await chooseMode('Original', 'original')
  await expect(page.locator('.ai-suggestion-proposal').first()).toBeHidden()
  await expect(page.locator('.ai-suggestion-mark[data-ai-suggestion-type="deletion"]').first()).toBeVisible()

  await chooseMode('Final', 'final')
  await expect(page.locator('.ai-suggestion-mark[data-ai-suggestion-type="deletion"]').first()).toBeHidden()
  await expect(page.locator('.ai-suggestion-proposal').first()).toBeVisible()

  const pendingAfter = await mcpTool(page, 'list_suggestions', { status: 'pending' }, 'tracked-display-after')
  expect((pendingAfter.data as { suggestions: unknown[] }).suggestions).toHaveLength(pendingCount)
})
