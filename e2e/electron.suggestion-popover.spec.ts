/**
 * The suggestion popover follows its mark (#1168).
 *
 * The card measured the mark once, on the click that opened it, and sat at
 * that screen point while the document scrolled away underneath. It now
 * re-anchors on scroll and resize like the comment popover, and closes once
 * its mark has left the pane.
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

const popover = () => page.locator('.ai-suggestion-popover')

async function scrollEditorBy(pixels: number): Promise<void> {
  await page.evaluate((dy) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    const container = editor.view.dom.closest('.overflow-auto') as HTMLElement
    container.scrollBy({ top: dy })
  }, pixels)
}

test.beforeAll(async () => {
  test.setTimeout(90_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1168-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-1168-docs-'))
  seedSettings(qaUserDataDir, { defaultSaveDirectory: qaDocsDir, aiConsent: { consented: true, version: 1 } })
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

test.describe('Electron — suggestion popover follows its mark (#1168)', () => {
  test('scrolling moves the popover with the mark, and scrolling it away closes it', async () => {
    const paragraphs = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} with enough words to take a line.`)
    paragraphs[4] = 'The sentence to improve.'
    const created = await executeProseTool(page, 'create_and_open_file', {
      filename: 'popover.md',
      content: `# Scroll\n\n${paragraphs.join('\n\n')}`
    })
    expect(created.success).toBe(true)
    await waitForEditor(page)

    const read = await executeProseTool(page, 'read_document', {})
    expect(read.success).toBe(true)
    interface DocNode { id: string; content?: string; children?: DocNode[] }
    const flatten = (nodes: DocNode[]): DocNode[] => nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
    const target = flatten((read.data as { nodes: DocNode[] }).nodes).find((n) => n.id && (n.content ?? '').includes('The sentence to improve.'))
    expect(target).toBeTruthy()
    const suggested = await executeProseTool(page, 'suggest_edit', { nodeId: target!.id, content: 'The sentence, improved.' })
    expect(suggested.success, JSON.stringify(suggested)).toBe(true)

    const mark = page.locator('.ai-suggestion-mark').first()
    await expect(mark).toBeVisible()
    await mark.click()
    await expect(popover()).toBeVisible()
    const before = (await popover().boundingBox())!
    const markBefore = (await mark.boundingBox())!

    // The card rides with its text: scrolled by 120 px, both move up by 120.
    await scrollEditorBy(120)
    await expect.poll(async () => Math.round((await mark.boundingBox())!.y)).toBe(Math.round(markBefore.y - 120))
    await expect.poll(async () => Math.round((await popover().boundingBox())!.y)).toBe(Math.round(before.y - 120))

    // Scrolled far enough that the mark leaves the pane, the card is gone for good.
    await scrollEditorBy(2000)
    await expect(popover()).toHaveCount(0)
    await scrollEditorBy(-2000)
    await expect(popover()).toHaveCount(0)
  })
})
