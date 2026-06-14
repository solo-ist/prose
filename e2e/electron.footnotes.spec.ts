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
