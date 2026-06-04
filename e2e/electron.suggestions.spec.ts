/**
 * AI suggestion acceptance tests — regression coverage for inline-markdown
 * suggestions landing as literal syntax characters (TestFlight v1.6.1 report:
 * accepted `**bold**` showed raw asterisks in the WYSIWYG doc and serialized
 * escaped as `\*\*bold\*\*`).
 *
 * Drives the aiSuggestion extension commands directly through the exposed
 * editor instance (window.__prose_editor) — no LLM involved. Uses an isolated
 * PROSE_USER_DATA_DIR profile so annotation-store writes never touch the
 * developer's real profile.
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
let qaFixturesDir: string

test.beforeAll(async () => {
  test.setTimeout(60_000)

  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-profile-'))
  qaFixturesDir = mkdtempSync(join(tmpdir(), 'prose-qa-fixtures-'))
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir } })
  app = launched.app
  page = launched.page

  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)

  // Fresh profile opens to the empty state — create a document to edit
  const newDocButton = page.getByRole('button', { name: 'New Document' })
  const isEmptyState = await newDocButton.isVisible({ timeout: 3_000 }).catch(() => false)
  if (isEmptyState) {
    await newDocButton.click({ force: true })
  }
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaFixturesDir, { recursive: true, force: true })
})

/** Apply a suggestion over the full content of a fresh paragraph and accept it. */
async function acceptSuggestion(
  testPage: Page,
  original: string,
  suggested: string,
): Promise<{ text: string; markdown: string; boldRuns: string[]; italicRuns: string[] }> {
  return testPage.evaluate(
    ([originalText, suggestedText]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      editor.commands.setContent(`<p>${originalText}</p>`)
      editor.commands.setTextSelection({ from: 1, to: 1 + originalText.length })
      editor.commands.setAISuggestion({
        id: 'qa-inline-md',
        type: 'edit',
        originalText,
        suggestedText,
        explanation: 'qa',
      })
      editor.commands.acceptAISuggestion('qa-inline-md')

      const boldRuns: string[] = []
      const italicRuns: string[] = []
      editor.state.doc.descendants((node: { isText: boolean; text?: string; marks: Array<{ type: { name: string } }> }) => {
        if (!node.isText) return
        if (node.marks.some((m) => m.type.name === 'bold')) boldRuns.push(node.text ?? '')
        if (node.marks.some((m) => m.type.name === 'italic')) italicRuns.push(node.text ?? '')
      })

      return {
        text: editor.state.doc.textContent as string,
        markdown: editor.storage.markdown.getMarkdown() as string,
        boldRuns,
        italicRuns,
      }
    },
    [original, suggested] as const,
  )
}

test.describe('Electron — AI suggestion acceptance', () => {
  test('inline markdown in a suggestion becomes real formatting, not literal asterisks', async () => {
    const result = await acceptSuggestion(
      page,
      'Plain sentence to be replaced.',
      '**Bold text** and *italic text* demonstrate inline formatting.',
    )

    // The rendered document must contain the visible text only — no asterisks
    expect(result.text).toBe('Bold text and italic text demonstrate inline formatting.')
    // The syntax must have become real marks
    expect(result.boldRuns).toContain('Bold text')
    expect(result.italicRuns).toContain('italic text')
    // Serialization must round-trip as markdown syntax, not escaped literals
    expect(result.markdown).toContain('**Bold text**')
    expect(result.markdown).not.toContain('\\*')
  })

  test('plain suggestions keep byte-for-byte insertion', async () => {
    const result = await acceptSuggestion(
      page,
      'Original wording for this sentence.',
      'Tightened wording for this sentence.',
    )

    expect(result.text).toBe('Tightened wording for this sentence.')
    expect(result.boldRuns).toHaveLength(0)
    expect(result.italicRuns).toHaveLength(0)
  })

  test('single-line list-like suggestions stay literal (conservative fallback)', async () => {
    // `- item` parses to a bullet list — a structural change the inline path
    // deliberately refuses; it must fall back to the existing literal insert
    // rather than restructure the paragraph. (Driving setAISuggestion
    // directly carries no blockConversionIntent — conversion only happens
    // when the suggestion goes through executeSuggestEdit, which has the
    // host-node context; see the block-conversion tests below and
    // electron.restructure.spec.ts.)
    const result = await acceptSuggestion(
      page,
      'A sentence that was here before.',
      '- bullet style replacement',
    )

    expect(result.text).toBe('- bullet style replacement')
  })
})

test.describe('Electron — suggest_edit guards and block conversion (#673)', () => {
  test('suggest_edit on a .txt document returns PLAIN_TEXT_DOCUMENT guidance', async () => {
    const txtPath = join(qaFixturesDir, 'plain-notes.txt')
    writeFileSync(txtPath, 'Some plain text content.\nAnother line of it.\n')

    const opened = await executeProseTool(page, 'open_file', { path: txtPath })
    expect(opened.success).toBe(true)
    await waitForEditor(page)

    const read = await executeProseTool(page, 'read_document', {})
    expect(read.success).toBe(true)
    const firstNode = (read.data as { nodes: Array<{ id: string }> }).nodes[0]

    const result = await executeProseTool(page, 'suggest_edit', {
      nodeId: firstNode.id,
      content: '# Some plain text content.',
    })
    expect(result.success).toBe(false)
    expect(result.code).toBe('PLAIN_TEXT_DOCUMENT')
    // The message must teach the model the recovery path
    expect(result.error).toContain('create_and_open_file')
  })

  test('suggest_edit inside a table returns TABLE_NODE_NOT_SUPPORTED guidance', async () => {
    const mdPath = join(qaFixturesDir, 'with-table.md')
    writeFileSync(
      mdPath,
      ['Intro paragraph.', '', '| Name | Role |', '| --- | --- |', '| Ada | Engineer |', ''].join('\n'),
    )

    const opened = await executeProseTool(page, 'open_file', { path: mdPath })
    expect(opened.success).toBe(true)
    await waitForEditor(page)

    // Table nodes carry no nodeId — the reachable target is the paragraph
    // inside a cell. Find it by content.
    const read = await executeProseTool(page, 'read_document', {})
    expect(read.success).toBe(true)
    interface DocNode { id: string; content?: string; children?: DocNode[] }
    const flatten = (nodes: DocNode[]): DocNode[] =>
      nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
    const cellNode = flatten((read.data as { nodes: DocNode[] }).nodes).find((n) =>
      (n.content ?? '').includes('Ada'),
    )

    // The cell paragraph may or may not surface in read_document's tree; if it
    // does, suggest_edit must refuse it. Either way a direct id-less search
    // fallback must also refuse.
    const result = await executeProseTool(page, 'suggest_edit', {
      nodeId: cellNode?.id ?? 'nonexistent-table-target',
      content: 'Grace',
      search: 'Ada',
    })
    expect(result.success).toBe(false)
    expect(['TABLE_NODE_NOT_SUPPORTED', 'NODE_NOT_FOUND']).toContain(result.code)
    if (result.code === 'TABLE_NODE_NOT_SUPPORTED') {
      expect(result.error).toContain('edit')
    }
  })

  test('block conversion via the executor: paragraph becomes heading', async () => {
    const mdPath = join(qaFixturesDir, 'convert-me.md')
    writeFileSync(mdPath, 'A future heading\n\nBody text stays a paragraph.\n')

    const opened = await executeProseTool(page, 'open_file', { path: mdPath })
    expect(opened.success).toBe(true)
    await waitForEditor(page)

    const read = await executeProseTool(page, 'read_document', {})
    const firstNode = (read.data as { nodes: Array<{ id: string }> }).nodes[0]

    const suggested = await executeProseTool(page, 'suggest_edit', {
      nodeId: firstNode.id,
      content: '## A future heading',
    })
    expect(suggested.success).toBe(true)

    const accepted = await executeProseTool(page, 'accept_diff', {
      id: (suggested.data as { suggestionId: string }).suggestionId,
    })
    expect(accepted.success).toBe(true)

    const outline = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      const nodes: Array<{ type: string; level?: number; text: string }> = []
      editor.state.doc.forEach(
        (node: { type: { name: string }; attrs: Record<string, unknown>; textContent: string }) => {
          nodes.push({
            type: node.type.name,
            ...(node.type.name === 'heading' ? { level: node.attrs.level as number } : {}),
            text: node.textContent,
          })
        },
      )
      return nodes
    })
    expect(outline[0]).toEqual({ type: 'heading', level: 2, text: 'A future heading' })
    expect(outline[1].type).toBe('paragraph')
  })
})
