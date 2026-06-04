/**
 * Document restructuring via AI suggestions (#673) — Case A of the AI
 * markdown hardening plan, the user's core scenario: a .md document whose
 * formatting was stripped (all flat paragraphs, e.g. after a .txt
 * round-trip), restored to structured markdown through suggest_edit calls
 * carrying block markup. Accepting them must CONVERT node types — paragraphs
 * become real headings/blockquotes/lists — not insert literal syntax.
 *
 * Drives the real tool pipeline (suggest_edit → accept_diff) through the
 * window.__prose_tools seam with zero LLM involvement, in an isolated
 * PROSE_USER_DATA_DIR profile.
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

// The flat, formatting-stripped document (post-.txt-round-trip state)
const FLAT_DOC = [
  'Test Document',
  '',
  'A test markdown document for editing demonstrations.',
  '',
  'Section One',
  '',
  'Sample text demonstrating paragraph structure.',
  '',
  'A wise quote belongs here.',
  '',
  'Item one of a list.',
].join('\n')

/** Top-level node summaries from the live editor doc. */
async function getDocOutline(
  testPage: Page,
): Promise<Array<{ type: string; level?: number; text: string }>> {
  return testPage.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    const outline: Array<{ type: string; level?: number; text: string }> = []
    editor.state.doc.forEach(
      (node: { type: { name: string }; attrs: Record<string, unknown>; textContent: string }) => {
        outline.push({
          type: node.type.name,
          ...(node.type.name === 'heading' ? { level: node.attrs.level as number } : {}),
          text: node.textContent,
        })
      },
    )
    return outline
  })
}

/** Resolve a top-level node's nodeId by its text content via read_document. */
async function nodeIdByText(testPage: Page, text: string): Promise<string> {
  const result = await executeProseTool(testPage, 'read_document', {})
  expect(result.success).toBe(true)
  const data = result.data as { nodes: Array<{ id: string; content?: string; children?: unknown[] }> }
  interface DocNode { id: string; content?: string; children?: DocNode[] }
  const flatten = (nodes: DocNode[]): DocNode[] =>
    nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
  const match = flatten(data.nodes as DocNode[]).find((n) => (n.content ?? '').includes(text))
  expect(match, `node containing "${text}"`).toBeTruthy()
  return match!.id
}

test.beforeAll(async () => {
  test.setTimeout(60_000)

  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-profile-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-qa-docs-'))
  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', icon: 'default' },
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

  const created = await executeProseTool(page, 'create_and_open_file', {
    filename: 'flat-restructure.md',
    content: FLAT_DOC,
  })
  expect(created.success).toBe(true)
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

test.describe('Electron — Restructure flat document via suggestions', () => {
  test('block-markup suggestions convert node types on accept', async () => {
    // Baseline: everything is a flat paragraph
    const before = await getDocOutline(page)
    expect(before.every((n) => n.type === 'paragraph')).toBe(true)

    // The "restore my formatting" suggestion set an agent would produce
    const titleId = await nodeIdByText(page, 'Test Document')
    const r1 = await executeProseTool(page, 'suggest_edit', {
      nodeId: titleId,
      content: '# Test Document',
      comment: 'Make this the document title',
    })
    expect(r1.success).toBe(true)

    const sectionId = await nodeIdByText(page, 'Section One')
    const r2 = await executeProseTool(page, 'suggest_edit', {
      nodeId: sectionId,
      content: '## Section One',
      comment: 'Promote to section heading',
    })
    expect(r2.success).toBe(true)

    const quoteId = await nodeIdByText(page, 'A wise quote belongs here.')
    const r3 = await executeProseTool(page, 'suggest_edit', {
      nodeId: quoteId,
      content: '> A wise quote belongs here.',
      comment: 'Format as blockquote',
    })
    expect(r3.success).toBe(true)

    const itemId = await nodeIdByText(page, 'Item one of a list.')
    const r4 = await executeProseTool(page, 'suggest_edit', {
      nodeId: itemId,
      content: '- Item one of a list.',
      comment: 'Format as list item',
    })
    expect(r4.success).toBe(true)

    // Accept the title individually (single-accept path)…
    const titleSuggestionId = (r1.data as { suggestionId: string }).suggestionId
    const acceptOne = await executeProseTool(page, 'accept_diff', { id: titleSuggestionId })
    expect(acceptOne.success).toBe(true)

    // …and the rest in one batch (accept-all path)
    const acceptRest = await executeProseTool(page, 'accept_diff', {})
    expect(acceptRest.success).toBe(true)

    // The document must now have real structure
    const after = await getDocOutline(page)
    const types = after.map((n) => `${n.type}${n.level ?? ''}`)
    expect(types).toContain('heading1')
    expect(types).toContain('heading2')
    expect(types).toContain('blockquote')
    expect(types).toContain('bulletList')

    const title = after.find((n) => n.type === 'heading' && n.level === 1)
    expect(title?.text).toBe('Test Document')
    const section = after.find((n) => n.type === 'heading' && n.level === 2)
    expect(section?.text).toBe('Section One')

    // Zero literal markdown syntax may survive in the rendered text
    const fullText = after.map((n) => n.text).join('\n')
    expect(fullText).not.toContain('#')
    expect(fullText).not.toContain('>')
    expect(fullText).not.toMatch(/^- /m)

    // And the serialization must be the intended markdown document
    const markdown = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      return editor.storage.markdown.getMarkdown() as string
    })
    expect(markdown).toContain('# Test Document')
    expect(markdown).toContain('## Section One')
    expect(markdown).toContain('> A wise quote belongs here.')
    expect(markdown).toContain('- Item one of a list.')
    expect(markdown).not.toContain('\\#')
    expect(markdown).not.toContain('\\>')
  })

  test('heading level change converts via the same path', async () => {
    // 'Section One' is now an H2 — promote it to H1 via suggestion
    const sectionId = await nodeIdByText(page, 'Section One')
    const r = await executeProseTool(page, 'suggest_edit', {
      nodeId: sectionId,
      content: '# Section One',
    })
    expect(r.success).toBe(true)
    const accept = await executeProseTool(page, 'accept_diff', {
      id: (r.data as { suggestionId: string }).suggestionId,
    })
    expect(accept.success).toBe(true)

    const outline = await getDocOutline(page)
    const section = outline.find((n) => n.text === 'Section One')
    expect(section?.type).toBe('heading')
    expect(section?.level).toBe(1)
  })
})
