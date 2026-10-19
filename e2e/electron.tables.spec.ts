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

  test('the rails appear for the inserted table', async () => {
    await insertTableViaMenu()
    await expect(page.locator('[data-testid="table-controls"]')).toBeVisible()
    await expect(page.locator('[data-testid="table-append-row"]')).toBeVisible()
    await expect(page.locator('[data-testid="table-append-col"]')).toBeVisible()
    await expect(page.locator('[data-testid="table-row-grip-0"]')).toBeVisible()
    await expect(page.locator('[data-testid="table-col-grip-0"]')).toBeVisible()
  })

  test('appending a row keeps it a pipe table', async () => {
    await insertTableViaMenu()
    const before = countRows(await getEditorMarkdown(page))

    await page.locator('[data-testid="table-append-row"]').click()

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
    expect(countRows(md)).toBe(before + 1)
  })

  test('appending a column keeps the header intact', async () => {
    await insertTableViaMenu()
    const before = countColumns(await getEditorMarkdown(page))

    await page.locator('[data-testid="table-append-col"]').click()

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
    expect(countColumns(md)).toBe(before + 1)
  })

  test('deleting the header row promotes the next one instead of breaking serialization', async () => {
    await insertTableViaMenu()
    const before = countRows(await getEditorMarkdown(page))

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

    await page.locator('[data-testid="table-row-grip-1"]').click()
    await expect(page.locator('[data-testid="table-active-toolbar"]')).toBeVisible()
    // Moving row 1 up would put non-header cells in the first row.
    await expect(page.locator('[data-testid="table-move-back"]')).toBeDisabled()
  })

  test('the header row itself offers no move', async () => {
    await insertTableViaMenu()

    await page.locator('[data-testid="table-row-grip-0"]').click()
    await expect(page.locator('[data-testid="table-active-toolbar"]')).toBeVisible()
    await expect(page.locator('[data-testid="table-move-back"]')).toBeDisabled()
    await expect(page.locator('[data-testid="table-move-forward"]')).toBeDisabled()
  })

  test('moving a column carries its header cell along', async () => {
    await insertTableViaMenu()

    await page.locator('[data-testid="table-col-grip-0"]').click()
    await expect(page.locator('[data-testid="table-active-toolbar"]')).toBeVisible()
    await page.locator('[data-testid="table-move-forward"]').click()

    const md = await getEditorMarkdown(page)
    expectPipeTable(md)
  })

  test('deleting a column keeps it a pipe table', async () => {
    await insertTableViaMenu()
    const before = countColumns(await getEditorMarkdown(page))

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
})
