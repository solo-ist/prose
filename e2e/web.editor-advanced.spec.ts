/**
 * Advanced editor formatting and keyboard shortcut tests — web mode.
 *
 * Covers TipTap formatting commands, markdown input rules, and keyboard
 * shortcuts. All tests run against the browser build with mock APIs.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  selectors,
  waitForEditor,
  setEditorContent,
  getEditorMarkdown,
  runEditorCommand,
  isMarkActive,
  isNodeActive,
  preseedSettings,
} from './shared'

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await preseedSettings(page)
  await waitForEditor(page)
})

test.afterAll(async () => {
  await page?.close()
})

test.describe('Editor — Advanced Formatting', () => {
  // -------------------------------------------------------------------------
  // Keyboard shortcuts — marks
  // -------------------------------------------------------------------------

  test('bold via Cmd+B', async () => {
    await setEditorContent(page, '<p>Hello world</p>')
    await page.click(selectors.editor)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('ControlOrMeta+B')
    await page.waitForTimeout(100)
    const active = await isMarkActive(page, 'bold')
    expect(active).toBe(true)
  })

  test('italic via Cmd+I', async () => {
    await setEditorContent(page, '<p>Hello world</p>')
    await page.click(selectors.editor)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('ControlOrMeta+I')
    await page.waitForTimeout(100)
    const active = await isMarkActive(page, 'italic')
    expect(active).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Markdown input rules — headings
  // -------------------------------------------------------------------------

  test('heading via # shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('# Hello')
    await page.waitForTimeout(100)
    const active = await isNodeActive(page, 'heading', { level: 1 })
    expect(active).toBe(true)
  })

  test('h2 via ## shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('## Hello')
    await page.waitForTimeout(100)
    const active = await isNodeActive(page, 'heading', { level: 2 })
    expect(active).toBe(true)
  })

  test('h3 via ### shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('### Hello')
    await page.waitForTimeout(100)
    const active = await isNodeActive(page, 'heading', { level: 3 })
    expect(active).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Markdown input rules — lists
  // -------------------------------------------------------------------------

  test('unordered list via - shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('- Item')
    await page.waitForTimeout(100)
    const active = await isNodeActive(page, 'bulletList')
    expect(active).toBe(true)
  })

  test('ordered list via 1. shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('1. Item')
    await page.waitForTimeout(100)
    const active = await isNodeActive(page, 'orderedList')
    expect(active).toBe(true)
  })

  test('task list via - [ ] shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('- [ ] Task')
    await page.waitForTimeout(100)
    const active = await isNodeActive(page, 'taskList')
    expect(active).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Markdown input rules — inline code and code block
  // -------------------------------------------------------------------------

  test('inline code via backticks', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('`code`')
    await page.waitForTimeout(100)
    const markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('`code`')
  })

  test('code block via triple backtick', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('```')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)
    const active = await isNodeActive(page, 'codeBlock')
    expect(active).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Markdown input rules — blockquote and horizontal rule
  // -------------------------------------------------------------------------

  test('blockquote via > shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('> Quote')
    await page.waitForTimeout(100)
    const active = await isNodeActive(page, 'blockquote')
    expect(active).toBe(true)
  })

  test('horizontal rule via ---', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('---')
    await page.waitForTimeout(100)
    const markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('---')
  })

  // -------------------------------------------------------------------------
  // Formatting commands via runEditorCommand
  // -------------------------------------------------------------------------

  test('strikethrough via command', async () => {
    await setEditorContent(page, '<p>Strike this</p>')
    await page.click(selectors.editor)
    await page.keyboard.press('ControlOrMeta+A')
    await runEditorCommand(page, 'toggleStrike')
    await page.waitForTimeout(100)
    const active = await isMarkActive(page, 'strike')
    expect(active).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Undo / redo
  // -------------------------------------------------------------------------

  test('undo via Cmd+Z', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('undo me')
    await page.waitForTimeout(100)

    let markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('undo me')

    await page.keyboard.press('ControlOrMeta+Z')
    await page.waitForTimeout(100)

    markdown = await getEditorMarkdown(page)
    expect(markdown).not.toContain('undo me')
  })

  test('redo via Cmd+Shift+Z', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('redo me')
    await page.waitForTimeout(100)

    // Undo to remove the typed text
    await page.keyboard.press('ControlOrMeta+Z')
    await page.waitForTimeout(100)

    let markdown = await getEditorMarkdown(page)
    expect(markdown).not.toContain('redo me')

    // Redo to restore
    await page.keyboard.press('ControlOrMeta+Shift+Z')
    await page.waitForTimeout(100)

    markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('redo me')
  })

  // -------------------------------------------------------------------------
  // Select all
  // -------------------------------------------------------------------------

  test('select all via Cmd+A', async () => {
    await setEditorContent(page, '<p>First paragraph</p><p>Second paragraph</p>')
    await page.click(selectors.editor)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('replacement text')
    await page.waitForTimeout(100)

    const markdown = await getEditorMarkdown(page)
    expect(markdown).toContain('replacement text')
    expect(markdown).not.toContain('First paragraph')
    expect(markdown).not.toContain('Second paragraph')
  })
})
