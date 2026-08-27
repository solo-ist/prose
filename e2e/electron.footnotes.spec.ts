/**
 * Footnote round-trip fidelity (#724 / PR #750).
 *
 * Regression guard for the silent data-loss bug where the Footnotes markdown
 * serializer used `footnote.textContent`, flattening every inline mark (bold,
 * italic, links, inline code) inside a footnote body on each save. The fix
 * renders footnote bodies through the markdown serializer (wrapBlock +
 * renderContent) so marks survive the round-trip.
 *
 * Negative control: revert the serializer to `footnote.textContent` and this
 * spec fails — getMarkdown() then emits the footnote body as plain text with
 * all `**`/`*`/`[...]()`/`` `...` `` markup stripped.
 *
 * Isolated PROSE_USER_DATA_DIR profile so create_and_open_file writes to a temp
 * dir, never the developer's real ~/Documents.
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
  typeInEditor,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

const RICH_FOOTNOTE_MARKDOWN = [
  'A paragraph that cites a source.[^1]',
  '',
  '[^1]: Body with **bold text**, an *italic word*, a [hyperlink](https://example.com), and `inline code`.',
].join('\n')

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

test.describe('Electron — Footnote markdown round-trip', () => {
  test('preserves inline formatting inside footnote bodies on serialize', async () => {
    const result = await executeProseTool(page, 'create_and_open_file', {
      filename: 'footnote-roundtrip.md',
      content: RICH_FOOTNOTE_MARKDOWN,
    })
    expect(result.success).toBe(true)

    await waitForEditor(page)

    // Re-serialize the open document and confirm the footnote body kept every
    // mark rather than collapsing to plain text.
    const md = await getEditorMarkdown(page)

    // The footnote definition must still be present and numbered.
    expect(md).toContain('[^1]:')
    // The reference in the body must round-trip too.
    expect(md).toContain('[^1]')

    // Inline marks inside the footnote body must survive (the whole point of
    // the fix — the old textContent path stripped all of these).
    expect(md).toContain('**bold text**')
    expect(md).toMatch(/[*_]italic word[*_]/)
    expect(md).toContain('[hyperlink](https://example.com)')
    expect(md).toContain('`inline code`')
  })
})

test.describe('Electron — Footnote interactive insertion', () => {
  // Guards the #750 HITL regression: tiptap-footnotes' addFootnote inserts the
  // reference at the selection anchor WITHOUT clearing the selection. With text
  // selected, the marker landed inside a live range and the next Enter
  // (splitBlock) deleted the selected text — "nothing happens, then the line
  // disappears". The fix collapses the selection to its end before inserting.
  test('Cmd+Shift+F inserts a footnote and never destroys the selected text', async () => {
    const result = await executeProseTool(page, 'create_and_open_file', {
      filename: 'footnote-interactive.md',
      content: 'The quick brown fox.',
    })
    expect(result.success).toBe(true)
    await waitForEditor(page)

    // Select the word "fox", then trigger the REAL Cmd+Shift+F handler. The
    // handler is a window keydown listener (Editor.tsx), so we dispatch a
    // synthetic keydown to window — reliable, and it exercises the actual
    // call-site chain (real Cmd-key presses are intercepted by macOS in e2e).
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      const idx = editor.state.doc.textContent.indexOf('fox')
      const from = idx + 1
      editor.chain().focus().setTextSelection({ from, to: from + 3 }).run()
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    await page.waitForTimeout(80)

    // The footnote reference and the footnotes section render in the live DOM.
    await expect(page.locator('.prose-editor sup a.footnote-ref')).toBeVisible()
    await expect(page.locator('.prose-editor ol.footnotes > li')).toBeVisible()

    // Insertion must not have deleted the selected word.
    const md = await getEditorMarkdown(page)
    expect(md).toContain('The quick brown fox')
    expect(md).toContain('[^1]')

    // Regression guard for the fix: the selection must be COLLAPSED after
    // insertion. The old bug left a live range spanning the inserted marker, so
    // the next Enter (splitBlock) deleted the selected text.
    const selectionEmpty = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__prose_editor.state.selection.empty,
    )
    expect(selectionEmpty).toBe(true)
  })
})

test.describe('Electron — Footnote input rule abutting text (#798)', () => {
  // Regression guard for the input rule mis-span bug: the base tiptap-footnotes
  // package uses an unanchored /\[\^(.*?)\]/ regex whose range.from is off by one
  // when '[' immediately follows a word character, so deleteRange left the leading
  // '[' behind (e.g. typing "claim[^1]" rendered as "claim[¹" instead of "claim¹").
  // The fix anchors the regex to $ and uses tr.replaceWith for an atomic replacement.

  test('abutting: [^1] directly after word creates reference without stray [', async () => {
    const result = await executeProseTool(page, 'create_and_open_file', {
      filename: 'footnote-inputrule-abutting.md',
      content: '',
    })
    expect(result.success).toBe(true)
    await waitForEditor(page)

    // Type the abutting pattern — '[' immediately follows the word 'claim'
    await typeInEditor(page, 'claim[^1]')
    await page.waitForTimeout(150)

    // The footnote reference node must be present in the DOM
    await expect(page.locator('.prose-editor sup a.footnote-ref')).toBeVisible()

    // The markdown serialization must NOT contain a stray '[' before the reference.
    // Correct: 'claim[^1]'. Buggy: 'claim[[^1]' (extra bracket).
    const md = await getEditorMarkdown(page)
    expect(md).toContain('claim[^1]')
    expect(md).not.toContain('claim[[^1]')

    // The paragraph text content must not include a literal '[' character —
    // the entire [^1] trigger must have been consumed by the input rule.
    const paragraphText = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__prose_editor.state.doc.firstChild?.textContent ?? '',
    )
    expect(paragraphText).not.toContain('[')
  })

  test('spaced: [^1] after a space also creates reference without stray [', async () => {
    const result = await executeProseTool(page, 'create_and_open_file', {
      filename: 'footnote-inputrule-spaced.md',
      content: '',
    })
    expect(result.success).toBe(true)
    await waitForEditor(page)

    // Type the spaced pattern — '[' follows a space, not a word character
    await typeInEditor(page, 'claim [^1]')
    await page.waitForTimeout(150)

    // The footnote reference node must be present in the DOM
    await expect(page.locator('.prose-editor sup a.footnote-ref')).toBeVisible()

    // Correct serialization: 'claim [^1]'. No stray '[' before the reference.
    const md = await getEditorMarkdown(page)
    expect(md).toContain('[^1]')
    expect(md).not.toContain('[[^1]')

    // The paragraph text must only contain 'claim ' — the [^1] trigger is fully consumed
    const paragraphText = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__prose_editor.state.doc.firstChild?.textContent ?? '',
    )
    expect(paragraphText.trim()).toBe('claim')
  })
})
