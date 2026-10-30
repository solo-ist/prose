/**
 * A tab switch brings back the caret and the scroll position (#1103).
 *
 * Tabs cached only the status bar's line/column, never a selection, and the
 * document-switch reload reset the view: fresh EditorState, scrollTop 0, then
 * focus at the start. Returning to a tab always landed at the top of the
 * document. The leaving tab now caches the editor's selection and the scroll
 * container's offset, and the reload restores both.
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
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1103-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-1103-docs-'))
  writeFileSync(join(qaUserDataDir, 'settings.json'), JSON.stringify({ defaultSaveDirectory: qaDocsDir }, null, 2))
  const result = await launchApp({
    env: { PROSE_USER_DATA_DIR: qaUserDataDir, PROSE_DOCS_DIR: qaDocsDir, PROSE_DEBUG_PORT: '9229' },
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

interface ViewState {
  from: number
  to: number
  scrollTop: number
  text: string
}

async function viewState(): Promise<ViewState> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    const container = editor.view.dom.closest('.overflow-auto') as HTMLElement | null
    return {
      from: editor.state.selection.from as number,
      to: editor.state.selection.to as number,
      scrollTop: container?.scrollTop ?? 0,
      text: editor.state.doc.textContent as string,
    }
  })
}

async function open(name: string, body: string): Promise<void> {
  writeFileSync(join(qaDocsDir, name), body)
  expect((await executeProseTool(page, 'open_file', { path: join(qaDocsDir, name) })).success).toBe(true)
  await waitForEditor(page)
  // A fresh open focuses the start and scrolls to the top 50ms after the load;
  // a click that lands inside that window is undone by it.
  await page.waitForTimeout(300)
}

async function clickTab(name: string, firstLine: string): Promise<void> {
  await page.locator('li button', { hasText: name }).first().click()
  await expect.poll(async () => (await viewState()).text).toContain(firstLine)
}

const longBody = (): string => {
  const paragraphs = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1} of the long document, kept short.`)
  return `# Long\n\n${paragraphs.join('\n\n')}\n`
}

test('switching away and back keeps the caret and the scroll position', async () => {
  await open('1103-other.md', '# Other\n\nA short one.\n')
  await open('1103-long.md', longBody())

  // Click deep into the document and type, so the caret and the scroll
  // offset are both well away from the top.
  await page.locator('.ProseMirror p', { hasText: 'Paragraph 60 of' }).first().click()
  // The paragraph wraps, so End would stop at the visual line; place the
  // caret at the paragraph's end directly.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    let end = -1
    editor.state.doc.descendants((node: { isTextblock: boolean; textContent: string; nodeSize: number }, pos: number) => {
      if (end === -1 && node.isTextblock && node.textContent.startsWith('Paragraph 60 of')) end = pos + node.nodeSize - 1
      return end === -1
    })
    editor.commands.setTextSelection(end)
  })
  await page.keyboard.type(' Marker.')
  await page.waitForTimeout(700) // past the editor's 500ms store debounce
  const before = await viewState()
  expect(before.text).toContain('Paragraph 60 of the long document, kept short. Marker.')
  expect(before.scrollTop).toBeGreaterThan(0)

  await clickTab('1103-other.md', 'Other')
  await clickTab('1103-long.md', 'Long')

  // The focus pass runs 50ms after the load; poll past it.
  await expect.poll(async () => (await viewState()).from).toBe(before.from)
  const after = await viewState()
  expect(after.to).toBe(before.to)
  expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThan(40)
  expect(after.text).toContain('Paragraph 60 of the long document, kept short. Marker.')
})

test('a tab visited for the first time still opens at the top', async () => {
  await open('1103-fresh.md', longBody())
  const state = await viewState()
  expect(state.scrollTop).toBe(0)
  expect(state.from).toBeLessThanOrEqual(1)
})
