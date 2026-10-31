/**
 * A restored comment lands on the occurrence it was made on (#1137).
 *
 * Creation and persistence count occurrences of the marked text in the raw
 * document text. The restore counted them in space-stripped text, where a
 * short word also matches across word boundaries ("that he" contains "the"),
 * so occurrence N was an earlier place in the document, and the next persist
 * rewrote the anchor from the wrong mark. The restore now searches the raw
 * text first and keeps the stripped search only for cross-block comments.
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
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1137-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-1137-docs-'))
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
  await open('1137-other.md', '# Other\n\nA short one.\n')
})

test.afterAll(async () => {
  await app.close().catch(() => {})
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

interface MarkedRun {
  id: string
  from: number
  text: string
}

async function open(name: string, body: string): Promise<void> {
  writeFileSync(join(qaDocsDir, name), body)
  expect((await executeProseTool(page, 'open_file', { path: join(qaDocsDir, name) })).success).toBe(true)
  await waitForEditor(page)
  await page.waitForTimeout(300)
}

async function clickTab(name: string, firstLine: string): Promise<void> {
  await page.locator('li button', { hasText: name }).first().click()
  await expect
    .poll(async () => page.evaluate(() => (window as any).__prose_editor.state.doc.textContent))
    .toContain(firstLine)
}

async function commentRuns(): Promise<MarkedRun[]> {
  return page.evaluate(() => {
    const editor = (window as any).__prose_editor
    const out: MarkedRun[] = []
    editor.state.doc.descendants((node: any, pos: number) => {
      if (!node.isText) return
      for (const m of node.marks) if (m.type.name === 'comment') out.push({ id: m.attrs.id, from: pos, text: node.text })
    })
    return out
  })
}

/** Position of `needle` inside the first textblock whose text starts with `blockStart`. */
async function posOf(blockStart: string, needle: string): Promise<number> {
  return page.evaluate(
    ({ blockStart, needle }) => {
      const editor = (window as any).__prose_editor
      let found = -1
      editor.state.doc.descendants((node: any, pos: number) => {
        if (found === -1 && node.isTextblock && node.textContent.startsWith(blockStart)) {
          found = pos + 1 + node.textContent.indexOf(needle)
        }
        return found === -1
      })
      return found
    },
    { blockStart, needle },
  )
}

async function commentRange(id: string, from: number, to: number): Promise<void> {
  await page.evaluate(
    ({ id, from, to }) => {
      const editor = (window as any).__prose_editor
      editor.chain().focus().setTextSelection({ from, to }).setComment({ id, comment: 'where am I' }).run()
    },
    { id, from, to },
  )
  await page.waitForTimeout(800) // past the store debounce so the thread persists
}

async function switchAwayAndBack(name: string, firstLine: string): Promise<MarkedRun[]> {
  await clickTab('1137-other.md', 'Other')
  await page.waitForTimeout(300)
  await clickTab(name, firstLine)
  // Marks restore 100ms after the load; give the pass room.
  await page.waitForTimeout(800)
  return commentRuns()
}

test('a comment on a short word comes back on that word, not an earlier cross-word match', async () => {
  // Stripped of spaces, "that he" and "at heart" both contain "the": three
  // matches the raw text does not have, all before the commented one.
  await open(
    '1137-word.md',
    '# Word\n\nIt was that he said it, at heart, and that he meant it.\n\nFiller paragraph with nothing to see.\n\nNow the point: the word sits here.\n',
  )
  const from = await posOf('Now the point', 'the word')
  await commentRange('c-word', from, from + 3)
  expect(await commentRuns()).toEqual([{ id: 'c-word', from, text: 'the' }])

  expect(await switchAwayAndBack('1137-word.md', 'Word')).toEqual([{ id: 'c-word', from, text: 'the' }])
})

test('a comment on a phrase with a space is not pulled onto a match that only exists without spaces', async () => {
  // "photo documentation" stripped is "photodocumentation", which contains
  // "todo"; the raw text has no earlier "to do".
  await open(
    '1137-phrase.md',
    '# Phrase\n\nThe photo documentation came in late.\n\nFiller paragraph with nothing to see.\n\nStill to do: the rest.\n',
  )
  const from = await posOf('Still to do', 'to do')
  await commentRange('c-phrase', from, from + 5)
  expect(await commentRuns()).toEqual([{ id: 'c-phrase', from, text: 'to do' }])

  expect(await switchAwayAndBack('1137-phrase.md', 'Phrase')).toEqual([{ id: 'c-phrase', from, text: 'to do' }])
})

test('a comment across two paragraphs still restores', async () => {
  // Its markedText carries a space block separator the raw text lacks, so the
  // raw search cannot match and the stripped search (#665) has to take over.
  await open('1137-cross.md', '# Cross\n\nFirst paragraph end.\n\nStart of the second.\n')
  const from = await posOf('First paragraph', 'end.')
  const to = (await posOf('Start of', 'Start')) + 'Start'.length
  await commentRange('c-cross', from, to)
  const before = await commentRuns()
  expect(before.map((r) => r.text)).toEqual(['end.', 'Start'])

  const after = await switchAwayAndBack('1137-cross.md', 'Cross')
  expect(after).toEqual(before)
})
