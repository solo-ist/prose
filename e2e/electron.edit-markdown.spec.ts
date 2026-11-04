/**
 * `edit` lands markdown as markdown (#1119).
 *
 * The streamed insertion parsed only its first word group; every later chunk
 * went in as raw text, so `**bold**` past the first words became literal
 * asterisks (saved as `\*\*bold\*\*`) and `Line one.\n\nLine two.` became one
 * paragraph with newlines in it. With reduced motion on, the whole payload was
 * parsed in one go and came out right. These cases run the real tool on the
 * shown document, with motion on and off, and read the saved markdown back.
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
  getEditorMarkdown,
  getAnnotations,
  getAnnotationDocId
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

const BOLD = 'After the table, with **bold** words in the middle.'
const BOLD_RENDERED = 'After the table, with bold words in the middle.'
const TWO_PARAGRAPHS = 'Line one.\n\nLine two.'
const PLAIN_LONG = Array.from({ length: 30 }, (_, i) => `word${i + 1}`).join(' ') + '.'

async function nodeIdByText(text: string): Promise<string> {
  const result = await executeProseTool(page, 'read_document', {})
  expect(result.success).toBe(true)
  interface DocNode {
    id: string
    content?: string
    children?: DocNode[]
  }
  const flatten = (nodes: DocNode[]): DocNode[] => nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
  // The deepest node with an id whose text matches: a table lists its cells'
  // text too but has no id of its own (#1100), so a cell's paragraph wins.
  const match = flatten((result.data as { nodes: DocNode[] }).nodes)
    .filter((n) => n.id && (n.content ?? '').includes(text))
    .pop()
  expect(match, `node containing "${text}"`).toBeTruthy()
  return match!.id
}

async function openDoc(filename: string): Promise<void> {
  const created = await executeProseTool(page, 'create_and_open_file', {
    filename,
    content: '# Edit\n\nA plain paragraph to edit.\n\nThe paragraph below it.'
  })
  expect(created.success).toBe(true)
  await waitForEditor(page)
}

async function edit(nodeId: string, content: string, messageId: string): Promise<void> {
  const docId = await getAnnotationDocId(page)
  expect(docId).toBeTruthy()
  const result = await executeProseTool(page, 'edit', { nodeId, content }, 'create', {
    model: 'Claude Test',
    conversationId: 'conversation-1119',
    messageId,
    documentId: docId!
  })
  expect(result.success, JSON.stringify(result)).toBe(true)
}

async function annotationText(messageId: string): Promise<string> {
  await expect
    .poll(async () =>
      (await getAnnotations(page)).filter((a) => (a.provenance as { messageId?: string }).messageId === messageId).length
    )
    .toBeGreaterThan(0)
  const records = (await getAnnotations(page)).filter(
    (a) => (a.provenance as { messageId?: string }).messageId === messageId
  )
  const from = Math.min(...records.map((a) => Number(a.from)))
  const to = Math.max(...records.map((a) => Number(a.to)))
  return page.evaluate(
    ([f, t]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__prose_editor.state.doc.textBetween(f, t),
    [from, to]
  )
}

async function paragraphCount(): Promise<number> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (window as any).__prose_editor.state.doc
    let count = 0
    doc.forEach((node: { type: { name: string } }) => {
      if (node.type.name === 'paragraph') count++
    })
    return count
  })
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1119-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-1119-docs-'))
  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify(
      { defaultSaveDirectory: qaDocsDir, aiConsent: { consented: true, version: 1 }, lastSeenVersion: '0.0.0' },
      null,
      2
    )
  )
  const result = await launchApp({
    env: { PROSE_USER_DATA_DIR: qaUserDataDir, PROSE_DOCS_DIR: qaDocsDir, PROSE_DEBUG_PORT: '9229' }
  })
  app = result.app
  page = result.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

for (const motion of ['on', 'off'] as const) {
  test.describe(`Electron — edit lands markdown as markdown, motion ${motion} (#1119)`, () => {
    test.beforeAll(async () => {
      await page.emulateMedia({ reducedMotion: motion === 'off' ? 'reduce' : 'no-preference' })
    })

    test('inline bold in a paragraph is bold, and the annotation covers the rendered text', async () => {
      await openDoc(`bold-${motion}.md`)
      await edit(await nodeIdByText('A plain paragraph to edit.'), BOLD, `m-bold-${motion}`)

      const md = await getEditorMarkdown(page)
      expect(md).toContain('with **bold** words')
      expect(md).not.toContain('\\*')
      await expect(page.locator('.ProseMirror strong', { hasText: 'bold' })).toHaveCount(1)
      expect(await annotationText(`m-bold-${motion}`)).toBe(BOLD_RENDERED)
    })

    test('two paragraphs come back as two paragraphs', async () => {
      await openDoc(`two-${motion}.md`)
      const before = await paragraphCount()
      await edit(await nodeIdByText('A plain paragraph to edit.'), TWO_PARAGRAPHS, `m-two-${motion}`)

      const md = await getEditorMarkdown(page)
      expect(md).toContain('Line one.\n\nLine two.')
      expect(await paragraphCount()).toBe(before + 1)
    })

    test('inline bold in a table cell is bold', async () => {
      await openDoc(`cell-${motion}.md`)
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = (window as any).__prose_editor
        editor.commands.focus(editor.state.doc.content.size - 1)
        window.dispatchEvent(new CustomEvent('menu:insertTable'))
      })
      await expect(page.locator('.prose-editor table')).toHaveCount(1)
      // Give the first cell a handle to address it by.
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = (window as any).__prose_editor
        let cellPos = -1
        editor.state.doc.descendants((node: { type: { name: string } }, pos: number) => {
          if (cellPos === -1 && node.type.name === 'tableHeader') cellPos = pos
          return cellPos === -1
        })
        editor.commands.insertContentAt(cellPos + 2, 'fruit')
      })
      await edit(await nodeIdByText('fruit'), 'a very **ripe** banana here', `m-cell-${motion}`)

      const md = await getEditorMarkdown(page)
      expect(md).toMatch(/^\|.*a very \*\*ripe\*\* banana here.*\|$/m)
      expect(md).not.toContain('\\*')
    })
  })
}

test.describe('Electron — a plain payload still streams (#1119)', () => {
  test.beforeAll(async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  })

  test('plain text goes in over several transactions when motion is on', async () => {
    await openDoc('plain-stream.md')
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any
      w.__txCount = 0
      w.__prose_editor.on('transaction', () => {
        w.__txCount++
      })
    })
    await edit(await nodeIdByText('A plain paragraph to edit.'), PLAIN_LONG, 'm-plain')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transactions = await page.evaluate(() => (window as any).__txCount as number)
    expect(transactions).toBeGreaterThanOrEqual(5)
    expect(await getEditorMarkdown(page)).toContain(PLAIN_LONG)
  })
})
