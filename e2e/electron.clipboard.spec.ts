/**
 * Clipboard — the text/plain flavor (#1054).
 *
 * Copying part of a bullet used to put the list marker on the clipboard
 * (`* ected te` instead of `ected te`), because tiptap-markdown's
 * clipboardTextSerializer discards the slice's open depths. Prose registers
 * its own serializer in editorProps to fix that.
 *
 * These assert the text/plain flavor directly from a synthetic copy event's
 * DataTransfer rather than through the OS clipboard — the serializer's output
 * is what's under test, and a real clipboard round trip under xvfb in CI adds
 * an environment dependency without testing anything more.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  setEditorContent,
} from './helpers'

let app: ElectronApplication
let page: Page

/** Doc position of the first occurrence of `needle` in a text node. */
async function findText(page: Page, needle: string): Promise<number> {
  const pos = await page.evaluate((text) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    let found = -1
    editor.state.doc.descendants((node: { isText: boolean; text?: string }, nodePos: number) => {
      if (found >= 0 || !node.isText || !node.text) return
      const idx = node.text.indexOf(text)
      if (idx >= 0) found = nodePos + idx
    })
    return found
  }, needle)
  expect(pos, `text not found in document: ${needle}`).toBeGreaterThanOrEqual(0)
  return pos
}

/** Select [from, to) and return what a copy would put on the clipboard as text/plain. */
async function copyRange(page: Page, from: number, to: number): Promise<string> {
  return page.evaluate(([f, t]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    editor.commands.setTextSelection({ from: f, to: t })
    const dt = new DataTransfer()
    editor.view.dom.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
    return dt.getData('text/plain')
  }, [from, to])
}

/** Select the given text and return the copied text/plain. */
async function copyText(page: Page, needle: string): Promise<string> {
  const from = await findText(page, needle)
  return copyRange(page, from, from + needle.length)
}

test.beforeAll(async () => {
  test.setTimeout(60_000)
  const launched = await launchApp()
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)

  const newDocButton = page.getByRole('button', { name: 'New Document' })
  if (await newDocButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await newDocButton.click({ force: true })
    await waitForEditor(page)
  }
})

test.afterAll(async () => {
  await app?.close()
})

test('partial selection inside a bullet carries no list marker', async () => {
  await setEditorContent(
    page,
    '<ul><li><p>First bullet item</p></li><li><p>Second bullet item</p></li></ul>',
  )
  expect(await copyText(page, 'bullet')).toBe('bullet')
})

test('a whole bullet copies as its text, without the marker', async () => {
  await setEditorContent(page, '<ul><li><p>First bullet item</p></li></ul>')
  expect(await copyText(page, 'First bullet item')).toBe('First bullet item')
})

test('a selection spanning bullets still copies as markdown', async () => {
  await setEditorContent(
    page,
    '<ul><li><p>First bullet item</p></li><li><p>Second bullet item</p></li></ul>',
  )
  const from = await findText(page, 'First bullet item')
  const to = (await findText(page, 'Second bullet item')) + 'Second bullet item'.length
  const copied = await copyRange(page, from, to)

  expect(copied).toContain('First bullet item')
  expect(copied).toContain('Second bullet item')
  // Structure is preserved for a multi-block selection — and gains no nesting.
  expect(copied.trimStart().startsWith('*')).toBe(true)
  expect(copied, 'no bullet should be indented').not.toMatch(/^[ \t]+[*-]/m)
})

test('partial selection inside a blockquote carries no > marker', async () => {
  await setEditorContent(page, '<blockquote><p>Quoted sentence here</p></blockquote>')
  expect(await copyText(page, 'sentence')).toBe('sentence')
})

test('partial selection inside a heading carries no # marker', async () => {
  await setEditorContent(page, '<h2>Section heading</h2>')
  expect(await copyText(page, 'heading')).toBe('heading')
})

test('partial selection inside a code block carries no fences', async () => {
  await setEditorContent(page, '<pre><code>const answer = 42</code></pre>')
  const copied = await copyText(page, 'answer')
  expect(copied).toBe('answer')
  expect(copied).not.toContain('```')
})

test('a multi-paragraph selection still copies as markdown', async () => {
  await setEditorContent(page, '<p>First paragraph</p><h3>A heading</h3><p>Second paragraph</p>')
  const from = await findText(page, 'First paragraph')
  const to = (await findText(page, 'Second paragraph')) + 'Second paragraph'.length
  const copied = await copyRange(page, from, to)

  // The regression guard: markdown copy must survive for structured selections.
  expect(copied).toContain('### A heading')
  expect(copied).toContain('First paragraph')
  expect(copied).toContain('Second paragraph')
})
