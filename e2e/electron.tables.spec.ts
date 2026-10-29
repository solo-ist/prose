/**
 * Table editing (#1060) — driven through the real rails/grips, asserting the
 * markdown after every structural operation.
 *
 * The assertion that matters is `not.toContain('<table')`. tiptap-markdown
 * serializes a table as a GFM pipe table only while the first row is entirely
 * `tableHeader`, no cell spans, and no cell holds more than one block
 * (tiptap-markdown/src/extensions/nodes/table.js:57-73). Break any of those and
 * it silently emits raw HTML instead — which means a row or column edit would
 * turn the user's markdown file into an HTML blob on save, with no error. So
 * each operation here re-reads the serialized markdown rather than trusting that
 * the document tree looks right.
 *
 * Setup mirrors electron.explorer-interactivity.spec.ts (90s budget, a seeded
 * defaultSaveDirectory) because that shape is CI-proven.
 *
 * The rails are **hover-revealed** since #1087, so every test that drives a grip
 * hovers the table first — `hoverRails()`. A test that forgets fails on a missing
 * grip rather than passing by accident.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  waitForEditor,
  dismissOnboarding,
  dismissOverlay,
  getEditorMarkdown,
  executeProseTool,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaFilesDir: string

/** A pipe table: at least one `|` row and a dash separator, and no HTML fallback. */
function expectPipeTable(markdown: string): void {
  expect(markdown).not.toContain('<table')
  expect(markdown).not.toContain('<td')
  expect(markdown).not.toContain('<th')
  expect(markdown).toMatch(/^\|.*\|$/m)
  expect(markdown).toMatch(/^\|\s*-+/m)
}

/**
 * Rows of actual content: every `|` line except the `| --- |` delimiter.
 * A freshly inserted 3x3 table is 3 (one header + two body).
 */
function countRows(markdown: string): number {
  return markdown
    .split('\n')
    .filter((l) => /^\|/.test(l.trim()))
    // The delimiter row is every cell being dashes (with optional alignment
    // colons). Matching on "dashes and pipes" alone would also swallow a row of
    // empty cells, which is exactly what a freshly inserted table is made of.
    .filter((l) => !/^\|(?:\s*:?-+:?\s*\|)+$/.test(l.trim())).length
}

function countColumns(markdown: string): number {
  const header = markdown.split('\n').find((l) => /^\|/.test(l.trim()))
  if (!header) return 0
  return header.trim().replace(/^\||\|$/g, '').split('|').length
}

async function insertTableViaMenu(): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('menu:insertTable')))
}

/**
 * Put the pointer over the table so the rails appear (#1087).
 *
 * Hover is now the only thing that reveals them — the caret sitting in a cell
 * does not — so this is a precondition for every grip interaction below.
 */
async function hoverRails(): Promise<void> {
  await page.locator('.prose-editor table').first().hover()
  await expect(page.locator('[data-testid="table-controls"]')).toBeVisible()
}

/** The document's top-level node types, as the editor currently holds them. */
async function topLevelNodes(): Promise<string[]> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return editor.state.doc.content.content.map((n: any) => n.type.name)
  })
}

test.beforeAll(async () => {
  test.setTimeout(90_000)

  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-tables-profile-'))
  qaFilesDir = mkdtempSync(join(tmpdir(), 'prose-qa-tables-files-'))
  writeFileSync(join(qaFilesDir, 'notes.md'), '# Notes\n')

  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify({ appearance: { mode: 'dark', icon: 'pilcrow' }, defaultSaveDirectory: qaFilesDir }, null, 2),
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
  rmSync(qaFilesDir, { recursive: true, force: true })
})

test.beforeEach(async () => {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    editor?.commands.setContent('<p></p>')
  })
})

test.describe('Electron — table editing (#1060)', () => {
  test('insert produces a header row that serializes as a pipe table', async () => {
    await waitForEditor(page)
    await insertTableViaMenu()

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
    // The default insert is 3 columns and 3 rows: one header plus two body.
    expect(countColumns(md)).toBe(3)
    expect(countRows(md)).toBe(3)
  })

  test('the caret alone does not reveal the rails (#1087)', async () => {
    await insertTableViaMenu()

    // Positive control first, so the absence asserted below cannot be an overlay
    // that was simply never able to render.
    await hoverRails()

    // Pointer clear of the table and its rail gutter: the rails go.
    await page.mouse.move(5, 5)
    await expect(page.locator('[data-testid="table-controls"]')).toHaveCount(0)

    // And the caret sitting in a cell does not bring them back. This is the
    // regression: before #1087 the column grips reappeared in the band directly
    // above the header row and stayed for the whole editing session, which read
    // as malformed table chrome rather than as controls.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__prose_editor.commands.focus(4)
    })
    // The old behaviour revealed them within ~10ms of the selection update, so a
    // settle is what makes this assertion mean something rather than win a race.
    await page.waitForTimeout(300)
    await expect(page.locator('[data-testid="table-controls"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="table-col-grip-0"]')).toHaveCount(0)
  })

  test('typing hides the rails until the pointer moves again (#1097)', async () => {
    await insertTableViaMenu()
    await hoverRails()

    // Typing with the pointer still over the table: hover alone would keep the
    // rails up for the whole editing session, because clicking into a cell
    // leaves the pointer on the table.
    await page.keyboard.type('abc')
    await expect(page.locator('[data-testid="table-controls"]')).toHaveCount(0)

    // Moving the pointer brings them straight back — the suppression is a
    // "get out of the way" gesture, not a mode.
    await hoverRails()
  })

  test('a grip operation does not dismiss its own rails (#1097)', async () => {
    // The regression this guards: binding the typing flag to editor.on('update')
    // instead of keydown would hide the rails on every row/column operation,
    // since each one changes the document.
    await insertTableViaMenu()
    await hoverRails()
    await page.locator('[data-testid="table-append-row"]').click()
    await expect(page.locator('[data-testid="table-controls"]')).toBeVisible()
  })

  test('hover reveals every rail, and a selected row pins them (#1087)', async () => {
    await insertTableViaMenu()
    await hoverRails()
    await expect(page.locator('[data-testid="table-append-row"]')).toBeVisible()
    await expect(page.locator('[data-testid="table-append-col"]')).toBeVisible()
    await expect(page.locator('[data-testid="table-row-grip-0"]')).toBeVisible()
    await expect(page.locator('[data-testid="table-col-grip-0"]')).toBeVisible()

    // A row selection is the one state that holds the rails without the pointer.
    // It has to: the toolbar it opens sits 136px to the table's left, so the
    // rails must survive the trip over there.
    await page.locator('[data-testid="table-row-grip-0"]').click()
    await expect(page.locator('[data-testid="table-active-toolbar"]')).toBeVisible()
    await page.mouse.move(5, 5)
    await page.waitForTimeout(300)
    await expect(page.locator('[data-testid="table-active-toolbar"]')).toBeVisible()
    await expect(page.locator('[data-testid="table-row-grip-0"]')).toBeVisible()
  })

  test('appending a row keeps it a pipe table', async () => {
    await insertTableViaMenu()
    const before = countRows(await getEditorMarkdown(page))

    await hoverRails()
    await page.locator('[data-testid="table-append-row"]').click()

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
    expect(countRows(md)).toBe(before + 1)
  })

  test('appending a column keeps the header intact', async () => {
    await insertTableViaMenu()
    const before = countColumns(await getEditorMarkdown(page))

    await hoverRails()
    await page.locator('[data-testid="table-append-col"]').click()

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
    expect(countColumns(md)).toBe(before + 1)
  })

  test('deleting the header row promotes the next one instead of breaking serialization', async () => {
    await insertTableViaMenu()
    const before = countRows(await getEditorMarkdown(page))

    await hoverRails()
    await page.locator('[data-testid="table-row-grip-0"]').click()
    await expect(page.locator('[data-testid="table-active-toolbar"]')).toBeVisible()
    await page.locator('[data-testid="table-delete"]').click()

    const md = await getEditorMarkdown(page)
    // The regression this guards: a plain deleteRow would leave a body row first,
    // and the whole table would come back as HTML.
    expectPipeTable(md)
    expect(countRows(md)).toBe(before - 1)
  })

  test('a body row cannot be moved above the header row', async () => {
    await insertTableViaMenu()
    await hoverRails()

    await page.locator('[data-testid="table-row-grip-1"]').click()
    await expect(page.locator('[data-testid="table-active-toolbar"]')).toBeVisible()
    // Moving row 1 up would put non-header cells in the first row.
    await expect(page.locator('[data-testid="table-move-back"]')).toBeDisabled()
  })

  test('the header row itself offers no move', async () => {
    await insertTableViaMenu()
    await hoverRails()

    await page.locator('[data-testid="table-row-grip-0"]').click()
    await expect(page.locator('[data-testid="table-active-toolbar"]')).toBeVisible()
    await expect(page.locator('[data-testid="table-move-back"]')).toBeDisabled()
    await expect(page.locator('[data-testid="table-move-forward"]')).toBeDisabled()
  })

  test('moving a column carries its header cell along', async () => {
    await insertTableViaMenu()
    await hoverRails()

    await page.locator('[data-testid="table-col-grip-0"]').click()
    await expect(page.locator('[data-testid="table-active-toolbar"]')).toBeVisible()
    await page.locator('[data-testid="table-move-forward"]').click()

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
  })

  test('deleting a column keeps it a pipe table', async () => {
    await insertTableViaMenu()
    const before = countColumns(await getEditorMarkdown(page))

    await hoverRails()
    await page.locator('[data-testid="table-col-grip-1"]').click()
    // Wait for the toolbar to settle: it animates in, and clicking a moving
    // target is what made this test flaky.
    await expect(page.locator('[data-testid="table-active-toolbar"]')).toBeVisible()
    await page.locator('[data-testid="table-delete"]').click()

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
    expect(countColumns(md)).toBe(before - 1)
  })

  test('Enter inside a cell adds a line break rather than breaking the table', async () => {
    await insertTableViaMenu()

    // Caret lands in the first header cell after insert; type, then Enter, then more.
    await page.keyboard.type('first')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second')

    const md = await getEditorMarkdown(page)
    // The regression: a paragraph split leaves the cell with two children, and
    // tiptap-markdown then emits the entire table as raw HTML.
    expectPipeTable(md)
    // Both halves survive, joined by the <br> the serializer uses inside tables.
    expect(md).toContain('first')
    expect(md).toContain('second')
    // Enter must not have added a row: still one header + two body.
    expect(countRows(md)).toBe(3)
    // The break is the <br> the serializer emits inside a table, not a newline
    // (a newline mid-row would corrupt the pipe syntax).
    expect(md).toContain('first<br>second')
  })

  test('a full round trip through the markdown serializer survives every edit', async () => {
    await insertTableViaMenu()
    await hoverRails()
    await page.locator('[data-testid="table-append-row"]').click()
    await page.locator('[data-testid="table-append-col"]').click()

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)

    // Reload that markdown as the document and confirm it still parses to a
    // table rather than arriving as an HTML blob or paragraph text.
    await page.evaluate((markdown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      editor?.commands.setContent(markdown)
    }, md)

    const reserialized = await getEditorMarkdown(page)
    expectPipeTable(reserialized)
    expect(countColumns(reserialized)).toBe(countColumns(md))
    expect(countRows(reserialized)).toBe(countRows(md))
  })

  test('a trailing table gets a paragraph after it, and that is where a click below lands (#1087)', async () => {
    await insertTableViaMenu()

    // Without TableTrailingParagraph the table is the document's last node and
    // the space below it holds no text position of its own: both a click there
    // and ArrowDown resolve back into the nearest cell, and the caret cannot
    // leave the table at all.
    const nodes = await topLevelNodes()
    expect(nodes).toContain('table')
    expect(nodes[nodes.length - 1]).toBe('paragraph')

    // The click is asserted through ProseMirror's own coordinate mapping rather
    // than a synthesized mouse click: the e2e window is never shown, and a
    // native click in it does not move the caret (measured — the same event does
    // fire React handlers, which is why the grips above are clickable). What the
    // user's click depends on is exactly this mapping: a point 40px below the
    // table must resolve to a position OUTSIDE the table.
    const box = await page.locator('.prose-editor table').first().boundingBox()
    if (!box) throw new Error('the table has no bounding box')
    const hit = await page.evaluate(
      (point) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = (window as any).__prose_editor
        const found = editor.view.posAtCoords({ left: point.x, top: point.y })
        if (!found) return null
        return ancestorNames(editor.state.doc.resolve(found.pos))

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function ancestorNames($pos: any): string[] {
          const names: string[] = []
          for (let depth = $pos.depth; depth >= 0; depth--) names.push($pos.node(depth).type.name)
          return names
        }
      },
      { x: box.x + 40, y: box.y + box.height + 40 },
    )
    expect(hit).toEqual(['paragraph', 'doc'])

    // And the keyboard gets out too: ArrowDown walks down the rows and then
    // leaves the table, where before it had nowhere to go.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__prose_editor.commands.focus(4)
    })
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown')

    const caret = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      const { $from } = editor.state.selection
      const names: string[] = []
      for (let depth = $from.depth; depth >= 0; depth--) names.push($from.node(depth).type.name)
      return names
    })
    expect(caret).toEqual(['paragraph', 'doc'])
  })

  test('the trailing paragraph leaves the markdown byte-identical (#1087)', async () => {
    // The load-bearing property. `Editor`'s onUpdate decides dirty state by
    // comparing the serialized markdown with what the store holds, so if the
    // appended paragraph changed a single character, every file that ends in a
    // table would show as unsaved the moment it was opened.
    //
    // Asserted by serializing the real document against a copy with the trailing
    // paragraph cut off — the same two docs the comparison sees.
    await page.evaluate((markdown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      editor?.commands.setContent(markdown)
    }, '| Name | Qty |\n| --- | --- |\n| Pens | 3 |')

    const nodes = await topLevelNodes()
    expect(nodes).toEqual(['table', 'paragraph'])

    const serialized = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      const { doc } = editor.state
      const trimmed = doc.copy(doc.content.cut(0, doc.content.size - doc.lastChild.nodeSize))
      return {
        withParagraph: editor.storage.markdown.serializer.serialize(doc),
        without: editor.storage.markdown.serializer.serialize(trimmed),
      }
    })
    expect(serialized.withParagraph).toBe(serialized.without)
    expect(serialized.withParagraph).toContain('| Pens | 3 |')
  })

  test('a row selection suppresses the text toolbar, text in a cell keeps it (#1087)', async () => {
    await insertTableViaMenu()

    // Text selected inside a cell is an ordinary TextSelection: bold, link and
    // comment all apply to it, so the popover must still appear. The selection is
    // made through the editor rather than with Shift+Arrow because the unshown
    // e2e window does not reliably update the native DOM selection.
    await page.keyboard.type('cell')
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      const { from } = editor.state.selection
      editor.commands.setTextSelection({ from: from - 'cell'.length, to: from })
    })
    await expect(page.locator('[data-testid="selection-popover"]')).toBeVisible()

    // A CellSelection is structural. It is neither empty nor a NodeSelection, so
    // it slipped past both of SelectionPopover's guards and opened the text
    // toolbar alongside the table one.
    await hoverRails()
    await page.locator('[data-testid="table-row-grip-0"]').click()
    await expect(page.locator('[data-testid="table-active-toolbar"]')).toBeVisible()
    await expect(page.locator('[data-testid="selection-popover"]')).toHaveCount(0)
  })
})

// The registry gives tables no nodeId, so a tool's only handle on one is a
// paragraph inside a cell. suggest_edit refuses those; its advice — use edit —
// has to hold for both a cell's text and the whole table (#1100).
test.describe('Electron — AI tools on tables (#1100)', () => {
  const TABLE_DOC = '| Name | Qty |\n| --- | --- |\n| apple | 1 |\n| pear | 2 |\n\nAfter the table.\n'

  async function loadTableDoc(): Promise<void> {
    await page.evaluate((markdown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__prose_editor?.commands.setContent(markdown)
    }, TABLE_DOC)
    await waitForEditor(page)
  }

  type DocNode = { id: string; type: string; content: string; children?: DocNode[] }

  async function readNodes(): Promise<DocNode[]> {
    const read = await executeProseTool(page, 'read_document', {})
    expect(read.success, 'read_document').toBe(true)
    return (read.data as { nodes: DocNode[] }).nodes
  }

  // Cells nest under their table's entry, so look through the whole tree.
  async function nodeIdOf(text: string): Promise<string> {
    const flatten = (nodes: DocNode[]): DocNode[] =>
      nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
    const node = flatten(await readNodes()).find((n) => n.content === text)
    expect(node, `node "${text}"`).toBeTruthy()
    return node!.id
  }

  // QA found the model could not tell a table was there: read_document listed
  // each cell as a top-level paragraph, so it told the writer rows could not be
  // added. The table has to be visible as one node, with its cells under it and
  // its current GFM as content, and that has to be enough to add a row.
  test('read_document shows the table as one node, and its cells are enough to add a row', async () => {
    await loadTableDoc()
    const nodes = await readNodes()

    const tables = nodes.filter((n) => n.type === 'table')
    expect(tables, 'one table node at the top level').toHaveLength(1)
    const table = tables[0]
    expect(table.content).toContain('| apple | 1 |')
    expectPipeTable(table.content)
    expect(table.children?.map((c) => c.content)).toEqual(['Name', 'Qty', 'apple', '1', 'pear', '2'])
    expect(nodes.map((n) => n.content), 'no cell at the top level').not.toContain('apple')
    expect(nodes.map((n) => n.content)).toContain('After the table.')

    // The route the model takes from that: any child id, plus the table it
    // was shown with a row appended.
    const result = await executeProseTool(page, 'edit', {
      nodeId: table.children![0].id,
      content: `${table.content}\n| plum | 5 |`,
    })
    expect(result.success, JSON.stringify(result)).toBe(true)
    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
    expect(countRows(md)).toBe(4)
    expect(md).toContain('| plum | 5 |')
    expect(md).toContain('After the table.')
  })

  test('suggest_edit on a cell refuses, and points at edit', async () => {
    await loadTableDoc()
    const result = await executeProseTool(page, 'suggest_edit', { nodeId: await nodeIdOf('apple'), content: 'banana' })
    expect(result.success).toBe(false)
    expect(result.code).toBe('TABLE_NODE_NOT_SUPPORTED')
    expect(result.error).toContain('full updated GFM table')
  })

  test('edit with one line changes just that cell', async () => {
    await loadTableDoc()
    const result = await executeProseTool(page, 'edit', { nodeId: await nodeIdOf('apple'), content: 'banana split' })
    expect(result.success, JSON.stringify(result)).toBe(true)

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
    expect(md).toContain('| banana split | 1 |')
    expect(countRows(md)).toBe(3)
  })

  test('edit with a full GFM table replaces the whole table', async () => {
    await loadTableDoc()
    const result = await executeProseTool(page, 'edit', {
      nodeId: await nodeIdOf('apple'),
      content: '| Name | Qty | Note |\n| --- | --- | --- |\n| banana | 3 | ripe |\n| pear | 2 | firm |\n| plum | 5 | soft |',
    })
    expect(result.success, JSON.stringify(result)).toBe(true)

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
    // One table, not a table spliced into a cell of the old one.
    expect(md.split('\n').filter((l) => /^\|(?:\s*:?-+:?\s*\|)+$/.test(l.trim()))).toHaveLength(1)
    expect(countColumns(md)).toBe(3)
    expect(countRows(md)).toBe(4)
    expect(md).toContain('| banana | 3 | ripe |')
    expect(md).not.toContain('apple')
    expect(md).toContain('After the table.')

    // And it survives a reparse as the same table.
    await page.evaluate((markdown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__prose_editor?.commands.setContent(markdown)
    }, md)
    const reserialized = await getEditorMarkdown(page)
    expectPipeTable(reserialized)
    expect(countRows(reserialized)).toBe(4)
    expect(countColumns(reserialized)).toBe(3)
  })

  test('edit with a table wrapped in prose is refused and changes nothing', async () => {
    await loadTableDoc()
    const before = await getEditorMarkdown(page)
    const result = await executeProseTool(page, 'edit', {
      nodeId: await nodeIdOf('apple'),
      content: 'Here is the update:\n\n| Name | Qty |\n| --- | --- |\n| banana | 1 |',
    })
    expect(result.success).toBe(false)
    expect(result.code).toBe('TABLE_CELL_MULTILINE')
    expect(await getEditorMarkdown(page)).toBe(before)
  })

  test('insert after a cell lands after the table, not inside its row', async () => {
    await loadTableDoc()
    const result = await executeProseTool(page, 'insert', {
      position: 'after_node',
      nodeId: await nodeIdOf('pear'),
      text: 'A note below the table.',
    })
    expect(result.success, JSON.stringify(result)).toBe(true)

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
    expect(countRows(md)).toBe(3)
    const lines = md.split('\n')
    const lastTableLine = lines.map((l) => /^\|/.test(l.trim())).lastIndexOf(true)
    const noteLine = lines.findIndex((l) => l.includes('A note below the table.'))
    expect(noteLine, 'note is its own block after the table').toBeGreaterThan(lastTableLine)
  })
})
