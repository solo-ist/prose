/**
 * Resolved AI suggestions stay resolved across a tab switch (#1126).
 *
 * Pending suggestions are persisted to IndexedDB and re-applied on load. Every
 * routine persist path refuses to write an empty set, on purpose (annotation
 * invariant, rule 1): an empty editor is usually a transient strip from a load
 * or a source-mode toggle. But accepting or rejecting the last suggestion is a
 * genuine empty, and nothing persisted it — so the stale set came back on the
 * next tab switch, and so did the suggestions the writer had already dealt with.
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
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1126-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-1126-docs-'))
  writeFileSync(join(qaUserDataDir, 'settings.json'), JSON.stringify({ defaultSaveDirectory: qaDocsDir }, null, 2))
  const result = await launchApp({
    env: { PROSE_USER_DATA_DIR: qaUserDataDir, PROSE_DOCS_DIR: qaDocsDir, PROSE_DEBUG_PORT: '9227' },
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

async function open(name: string, firstLine: string): Promise<void> {
  const path = join(qaDocsDir, name)
  writeFileSync(path, `# ${firstLine}\n\nThe sentence to suggest on.\n\nA second paragraph.\n`)
  const opened = await executeProseTool(page, 'open_file', { path })
  expect(opened.success, `open_file ${name}`).toBe(true)
  await waitForEditor(page)
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (text) => ((window as any).__prose_editor?.state.doc.textContent as string | undefined)?.includes(text),
    firstLine,
    { timeout: 5_000 },
  )
}

/**
 * Click the tab in the tab bar. The `select_tab` tool saves the live set
 * unconditionally on its way out, so it never showed this bug; a click goes
 * through useTabs, whose tab-switch save skips an empty set.
 */
async function switchTo(name: string, firstLine: string): Promise<void> {
  await page.locator('li button', { hasText: name }).first().click()
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (text) => ((window as any).__prose_editor?.state.doc.textContent as string | undefined)?.includes(text),
    firstLine,
    { timeout: 5_000 },
  )
}

/** Suggest a replacement for the second paragraph, as the suggest_edit tool would. */
async function suggestOnSentence(id: string): Promise<void> {
  await page.evaluate((suggestionId) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    const original = 'The sentence to suggest on.'
    let from = -1
    editor.state.doc.descendants((node: { isText: boolean; text?: string }, pos: number) => {
      if (from === -1 && node.isText && node.text === original) from = pos
    })
    if (from === -1) throw new Error('sentence not found')
    editor.commands.setTextSelection({ from, to: from + original.length })
    editor.commands.setAISuggestion({
      id: suggestionId,
      type: 'edit',
      originalText: original,
      suggestedText: 'The sentence, rewritten.',
      explanation: 'qa',
    })
  }, id)
  await expect.poll(liveSuggestionIds).toContain(id)
  // Let the debounced persist write the (non-empty) set to IndexedDB, which is
  // what a later load reads back.
  await page.waitForTimeout(1_000)
}

async function liveSuggestionIds(): Promise<string[]> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    const ids = new Set<string>()
    editor.state.doc.descendants((node: { marks: Array<{ type: { name: string }; attrs: { id?: string } }> }) => {
      for (const mark of node.marks) if (mark.type.name === 'aiSuggestion' && mark.attrs.id) ids.add(mark.attrs.id)
    })
    return [...ids]
  })
}

test('a rejected suggestion does not come back after a tab switch', async () => {
  await open('1126-reject-other.md', 'Reject other')
  await open('1126-reject.md', 'Reject home')
  await suggestOnSentence('qa-1126-reject')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).__prose_editor.commands.rejectAISuggestion('qa-1126-reject'))
  await expect.poll(liveSuggestionIds).toEqual([])
  // Past the editor's 500ms store debounce: a tab-bar switch inside it drops the
  // change itself, which is #1127, not this bug.
  await page.waitForTimeout(800)

  await switchTo('1126-reject-other.md', 'Reject other')
  await switchTo('1126-reject.md', 'Reject home')
  await page.waitForTimeout(1_500)

  expect(await liveSuggestionIds()).toEqual([])
})

test('an accepted suggestion does not come back after a tab switch', async () => {
  await open('1126-accept-other.md', 'Accept other')
  await open('1126-accept.md', 'Accept home')
  await suggestOnSentence('qa-1126-accept')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).__prose_editor.commands.acceptAISuggestion('qa-1126-accept'))
  await expect.poll(liveSuggestionIds).toEqual([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect(await page.evaluate(() => (window as any).__prose_editor.state.doc.textContent)).toContain('The sentence, rewritten.')
  await page.waitForTimeout(800) // see the reject test — #1127

  await switchTo('1126-accept-other.md', 'Accept other')
  await switchTo('1126-accept.md', 'Accept home')
  await page.waitForTimeout(1_500)

  expect(await liveSuggestionIds()).toEqual([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect(await page.evaluate(() => (window as any).__prose_editor.state.doc.textContent)).toContain('The sentence, rewritten.')
})
