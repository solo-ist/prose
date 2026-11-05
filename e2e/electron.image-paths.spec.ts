/**
 * An image whose file name holds spaces survives the round trip (#1133).
 *
 * The image node used to serialize its `src` raw, and markdown-it reads a
 * destination with spaces as text, so a pasted macOS screenshot turned into
 * the literal `![Screenshot …](Screenshot 2026-10-30 at 1.45.22 AM.png)` on
 * the next tab switch or reopen. The source is now percent-encoded on the
 * way out, and the local-file handler decodes it on the way back in.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  executeProseTool,
  getEditorMarkdown,
  seedSettings,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

// A macOS screenshot name: spaces and the narrow no-break space before AM.
const IMAGE_NAME = 'Screenshot 2026-10-30 at 1.45.22 AM.png'
const ENCODED = 'Screenshot%202026-10-30%20at%201.45.22%E2%80%AFAM.png'

// A 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

test.beforeAll(async () => {
  test.setTimeout(90_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1133-'))
  // Under the home directory, not the system temp dir: the local-file handler
  // serves images only from inside home (#918), as the real app does.
  qaDocsDir = mkdtempSync(join(homedir(), 'prose-e2e-1133-'))
  writeFileSync(join(qaDocsDir, IMAGE_NAME), PNG)
  seedSettings(qaUserDataDir, { defaultSaveDirectory: qaDocsDir, aiConsent: { consented: false, version: 1 } })
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

test.describe('Electron — image file names with spaces (#1133)', () => {
  test('a spaced image name is written encoded, reloads as an image, and the image loads', async () => {
    // A saved document in the folder that holds the PNG, as after a paste.
    const created = await executeProseTool(page, 'create_and_open_file', {
      filename: 'shots.md',
      content: '# Shots\n\nBefore the picture.'
    })
    expect(created.success).toBe(true)
    await waitForEditor(page)

    await page.evaluate((src) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      editor.commands.focus('end')
      editor.commands.insertContent({ type: 'image', attrs: { src, alt: 'Screenshot' } })
    }, IMAGE_NAME)

    const md = await getEditorMarkdown(page)
    expect(md).toContain(`![Screenshot](${ENCODED})`)
    expect(md).not.toContain('\\[')

    // Reload the markdown as a tab switch or reopen would: an image, not text.
    await page.evaluate((markdown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__prose_editor.commands.setContent(markdown)
    }, md)
    // One image node (the node view renders more than one <img> element).
    const imageNodes = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (window as any).__prose_editor.state.doc
      let count = 0
      doc.descendants((node: { type: { name: string } }) => {
        if (node.type.name === 'image') count++
        return true
      })
      return count
    })
    expect(imageNodes).toBe(1)
    await expect(page.locator('.ProseMirror')).not.toContainText('![Screenshot]')
    const img = page.locator('.ProseMirror img').first()
    await expect(img).toBeVisible()
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))
      .toBe(true)

    expect(await getEditorMarkdown(page)).toBe(md)
  })

  // A relative image path resolves against its own document's folder after a
  // tab switch, not the folder of the tab that was active before (#1204): the
  // node views are rebuilt on the switch, before the active-document mirror
  // is updated.
  test('the image survives a switch to a document in another folder and back', async () => {
    const otherDir = mkdtempSync(join(homedir(), 'prose-e2e-1204-'))
    try {
      const otherPath = join(otherDir, 'elsewhere.md')
      writeFileSync(otherPath, '# Elsewhere\n\nAnother folder.')
      const created = await executeProseTool(page, 'create_and_open_file', {
        filename: 'shots-switch.md',
        content: `# Shots\n\n![Screenshot](${ENCODED})\n\nAfter the picture.`
      })
      expect(created.success, JSON.stringify(created)).toBe(true)
      await waitForEditor(page)
      // `img.editor-image`: ProseMirror wraps an inline node view in
      // zero-size `img.ProseMirror-separator` elements, which a bare `img`
      // locator finds first.
      const img = () => page.locator('.ProseMirror img.editor-image').first()
      const loaded = () => img().evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)
      await expect.poll(loaded).toBe(true)

      const away = await executeProseTool(page, 'open_file', { path: otherPath })
      expect(away.success, JSON.stringify(away)).toBe(true)
      await expect(page.locator('.ProseMirror')).toContainText('Another folder')
      const back = await executeProseTool(page, 'open_file', { path: join(qaDocsDir, 'shots-switch.md') })
      expect(back.success, JSON.stringify(back)).toBe(true)
      await expect(page.locator('.ProseMirror')).toContainText('After the picture')

      const src = decodeURIComponent(await img().evaluate((el) => (el as HTMLImageElement).src))
      expect(src).toContain(`${qaDocsDir}/`)
      expect(src).not.toContain(otherDir)
      await expect.poll(loaded, { message: `after the switch back, src=${src}` }).toBe(true)
    } finally {
      rmSync(otherDir, { recursive: true, force: true })
    }
  })
})
