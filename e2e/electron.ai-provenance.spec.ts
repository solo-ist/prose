/**
 * AI provenance for content that does not come from normal in-app insert/edit
 * tool calls (#570): create-from-scratch, MCP-style tool provenance, and paste.
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
  selectors,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

interface DocNode {
  id: string
  content?: string
  children?: DocNode[]
}

async function nodeIdByText(testPage: Page, text: string): Promise<string> {
  const result = await executeProseTool(testPage, 'read_document', {})
  expect(result.success).toBe(true)
  const flatten = (nodes: DocNode[]): DocNode[] =>
    nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])])
  const match = flatten((result.data as { nodes: DocNode[] }).nodes).find((node) =>
    (node.content ?? '').includes(text),
  )
  expect(match, `node containing "${text}"`).toBeTruthy()
  return match!.id
}

async function pasteText(testPage: Page, text: string): Promise<void> {
  await testPage.click(selectors.editor)
  await testPage.evaluate((clipboardText) => {
    const target = document.querySelector('.ProseMirror')
    if (!target) throw new Error('Editor not found')

    const data = new DataTransfer()
    data.setData('text/plain', clipboardText)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: data })
    target.dispatchEvent(event)
  }, text)
}

test.beforeAll(async () => {
  test.setTimeout(60_000)

  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-profile-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-qa-docs-'))
  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', icon: 'pilcrow' },
        defaultSaveDirectory: qaDocsDir,
        featureFlags: { aiPipelineDebug: true },
      },
      null,
      2,
    ),
  )

  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir } })
  app = launched.app
  page = launched.page

  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

test.describe('Electron - AI provenance for create, MCP, and paste', () => {
  test('create_and_open_file annotates the created document body', async () => {
    const result = await executeProseTool(
      page,
      'create_and_open_file',
      {
        filename: 'provenance-create.md',
        content: '# Generated Draft\n\nThis entire document came from the AI.',
      },
      'create',
      {
        model: 'Claude Test',
        conversationId: 'conversation-create',
        messageId: 'message-create',
        documentId: 'previous-document',
      },
    )
    expect(result.success).toBe(true)
    await waitForEditor(page)

    await expect
      .poll(async () => getAnnotations(page), { timeout: 5_000 })
      .toHaveLength(1)

    const annotations = await getAnnotations(page)
    const docId = await getAnnotationDocId(page)
    expect(annotations[0].documentId).toBe(docId)
    expect(annotations[0].type).toBe('insertion')
    expect(annotations[0].from).toBe(0)
    expect(Number(annotations[0].to)).toBeGreaterThan(0)
    expect(annotations[0].provenance).toMatchObject({
      model: 'Claude Test',
      conversationId: 'conversation-create',
      messageId: 'message-create',
    })
  })

  test('MCP-style edit provenance reaches the annotation path', async () => {
    const nodeId = await nodeIdByText(page, 'This entire document came from the AI.')
    const docId = await getAnnotationDocId(page)
    expect(docId).toBeTruthy()

    const result = await executeProseTool(
      page,
      'edit',
      {
        nodeId,
        search: 'This entire document came from the AI.',
        content: 'This paragraph was revised from Claude Desktop.',
        comment: 'MCP edit provenance',
      },
      'create',
      {
        model: 'Claude (MCP)',
        conversationId: 'mcp-570',
        messageId: 'mcp-edit-570',
        documentId: docId!,
      },
    )
    expect(result.success).toBe(true)

    await expect
      .poll(async () => getAnnotations(page), { timeout: 5_000 })
      .toContainEqual(
        expect.objectContaining({
          provenance: expect.objectContaining({
            model: 'Claude (MCP)',
            conversationId: 'mcp-570',
            messageId: 'mcp-edit-570',
          }),
        }),
      )
  })

  test('sizable paste prompts and can be marked as externally AI-authored', async () => {
    const pasted = [
      'This pasted block came from another AI surface.',
      '',
      'It has enough structure to ask for provenance.',
    ].join('\n')

    await pasteText(page, pasted)

    const dialog = page.getByRole('dialog', { name: 'Mark pasted text as AI-authored?' })
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Mark as AI-authored' }).click()

    await expect
      .poll(async () => getAnnotations(page), { timeout: 5_000 })
      .toContainEqual(
        expect.objectContaining({
          provenance: expect.objectContaining({
            model: 'External AI',
            conversationId: 'paste',
          }),
        }),
      )
  })

  test('short single-line paste does not prompt', async () => {
    await pasteText(page, 'short paste')

    await expect(
      page.getByRole('dialog', { name: 'Mark pasted text as AI-authored?' }),
    ).toBeHidden({ timeout: 1_000 })
  })
})

// A streamed write yields a frame per chunk, so the document can change under
// it — the writer typing below the node. The annotation must cover exactly
// what the AI wrote, not the whole document's growth while it streamed
// (#1101). Multi-paragraph content takes the full-range branch that uses the
// endpoint directly.
test.describe('Electron - streamed write annotation range (#1101)', () => {
  const AI_TEXT = 'one two three four five six.\n\nseven eight nine ten eleven twelve.'

  /** Run a tool and, two frames into its stream, type at the end of the doc. */
  async function writeWhileTyping(
    tool: 'edit' | 'insert',
    args: Record<string, unknown>,
    messageId: string,
  ): Promise<Record<string, unknown>> {
    const docId = await getAnnotationDocId(page)
    expect(docId).toBeTruthy()
    const ok = await page.evaluate(async ({ tool, args, docId, messageId }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any
      const editor = w.__prose_editor
      const run = w.__prose_tools.executeTool(tool, args, 'create', {
        model: 'Claude Test', conversationId: 'conversation-1101', messageId, documentId: docId,
      })
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
      editor.view.dispatch(editor.state.tr.insertText(' TYPED', editor.state.doc.content.size - 1))
      return (await run).success
    }, { tool, args, docId: docId!, messageId })
    expect(ok, `${tool} succeeded`).toBe(true)
    await expect
      .poll(async () => (await getAnnotations(page)).filter((a) => (a.provenance as { messageId?: string }).messageId === messageId).length)
      .toBe(1)
    return (await getAnnotations(page)).find((a) => (a.provenance as { messageId?: string }).messageId === messageId)!
  }

  async function openDoc(filename: string): Promise<void> {
    const created = await executeProseTool(page, 'create_and_open_file', {
      filename,
      content: '# Range\n\nA plain paragraph to edit.\n\nThe paragraph below it.',
    })
    expect(created.success).toBe(true)
    await waitForEditor(page)
  }

  test('edit: typing mid-stream does not stretch the annotation', async () => {
    await openDoc('range-edit.md')
    const ann = await writeWhileTyping('edit', {
      nodeId: await nodeIdByText(page, 'A plain paragraph to edit.'),
      search: 'A plain paragraph to edit.',
      content: AI_TEXT,
    }, 'msg-1101-edit')
    expect(Number(ann.to) - Number(ann.from)).toBe(AI_TEXT.length)
    expect(await page.evaluate(() => document.body.textContent?.includes('TYPED'))).toBe(true)
    const painted = await page.evaluate(() => Array.from(document.querySelectorAll('.ai-annotation'), (e) => e.textContent).join(''))
    expect(painted).not.toContain('The paragraph below')
  })

  test('insert at the cursor: typing mid-stream does not stretch the annotation', async () => {
    await openDoc('range-insert.md')
    // Caret at the end of the first paragraph's text.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      let end = -1
      editor.state.doc.descendants((node: { isTextblock: boolean; textContent: string; nodeSize: number }, pos: number) => {
        if (end === -1 && node.isTextblock && node.textContent === 'A plain paragraph to edit.') end = pos + node.nodeSize - 1
      })
      editor.commands.setTextSelection(end)
    })
    const ann = await writeWhileTyping('insert', { position: 'cursor', text: AI_TEXT }, 'msg-1101-insert')
    expect(Number(ann.to) - Number(ann.from)).toBe(AI_TEXT.length)
  })
})

