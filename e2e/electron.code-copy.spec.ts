/**
 * The copy button on code blocks (#1111).
 *
 * A block shows a button on hover that copies its plain text, never the
 * fence or the language tag, without touching the caret; a read-only editor
 * shows none.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay, waitForEditor, executeProseTool, seedSettings } from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

const CODE = 'const answer = 42\nconsole.log(answer)'

test.beforeAll(async () => {
  test.setTimeout(90_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1111-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-1111-docs-'))
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

test.describe('Electron — code block copy button (#1111)', () => {
  test('copies the block text without the fence, keeps the caret, and hides when read-only', async () => {
    const created = await executeProseTool(page, 'create_and_open_file', {
      filename: 'copy.md',
      content: `# Copy\n\nBefore.\n\n\`\`\`ts\n${CODE}\n\`\`\`\n\nAfter.`
    })
    expect(created.success).toBe(true)
    await waitForEditor(page)

    const block = page.locator('.ProseMirror pre').first()
    await expect(block).toHaveCount(1)
    const button = page.locator('.ProseMirror [data-testid="code-copy"]')
    await expect(button).toHaveCount(1)
    // A glyph, not a word (#1205): the label carries the text.
    await expect(button).toHaveAttribute('aria-label', 'Copy code')
    await expect(button).toHaveAttribute('data-state', 'idle')
    await expect(button.locator('svg')).toHaveCount(1)
    await expect(button).toHaveText('')

    // Park the caret inside the block, then copy: the caret must stay put.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__prose_editor.commands.focus(12)
    })
    const before = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__prose_editor.state.selection
      return [s.from, s.to]
    })
    await app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
    await block.hover()
    await expect(button).toBeVisible()
    await button.click()

    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(CODE)
    const after = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__prose_editor.state.selection
      return [s.from, s.to]
    })
    expect(after).toEqual(before)
    await expect(button).toHaveAttribute('data-state', 'copied')
    await expect(button).toHaveAttribute('aria-label', 'Copied')
    await expect(button).toHaveText('')
    await expect(button).toHaveAttribute('data-state', 'idle', { timeout: 4000 })

    // Read-only: no button; editable again: back.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__prose_editor.setEditable(false)
    })
    await expect(button).toBeHidden()
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__prose_editor.setEditable(true)
    })
    await block.hover()
    await expect(button).toBeVisible()
  })
})
