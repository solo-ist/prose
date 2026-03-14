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
    await expect.poll(() => isMarkActive(page, 'bold')).toBe(true)
  })

  test('italic via Cmd+I', async () => {
    await setEditorContent(page, '<p>Hello world</p>')
    await page.click(selectors.editor)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('ControlOrMeta+I')
    await expect.poll(() => isMarkActive(page, 'italic')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Markdown input rules — headings
  // -------------------------------------------------------------------------

  test('heading via # shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('# Hello')
    await expect.poll(() => isNodeActive(page, 'heading', { level: 1 })).toBe(true)
  })

  test('h2 via ## shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('## Hello')
    await expect.poll(() => isNodeActive(page, 'heading', { level: 2 })).toBe(true)
  })

  test('h3 via ### shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('### Hello')
    await expect.poll(() => isNodeActive(page, 'heading', { level: 3 })).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Markdown input rules — lists
  // -------------------------------------------------------------------------

  test('unordered list via - shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('- Item')
    await expect.poll(() => isNodeActive(page, 'bulletList')).toBe(true)
  })

  test('ordered list via 1. shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('1. Item')
    await expect.poll(() => isNodeActive(page, 'orderedList')).toBe(true)
  })

  test('underline via command', async () => {
    // Task list extension not installed — test underline instead
    await setEditorContent(page, '<p>Underline this</p>')
    await page.click(selectors.editor)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('ControlOrMeta+U')
    await expect.poll(() => isMarkActive(page, 'underline')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Markdown input rules — inline code and code block
  // -------------------------------------------------------------------------

  test('inline code via backticks', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('`code`')
    await expect.poll(async () => {
      const markdown = await getEditorMarkdown(page)
      return markdown.includes('`code`')
    }).toBe(true)
  })

  test('code block via triple backtick', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('```')
    await page.keyboard.press('Enter')
    await expect.poll(() => isNodeActive(page, 'codeBlock')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Markdown input rules — blockquote and horizontal rule
  // -------------------------------------------------------------------------

  test('blockquote via > shortcut', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('> Quote')
    await expect.poll(() => isNodeActive(page, 'blockquote')).toBe(true)
  })

  test('horizontal rule via ---', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('---')
    await expect.poll(async () => {
      const markdown = await getEditorMarkdown(page)
      return markdown.includes('---')
    }).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Formatting commands via runEditorCommand
  // -------------------------------------------------------------------------

  test('strikethrough via command', async () => {
    await setEditorContent(page, '<p>Strike this</p>')
    await page.click(selectors.editor)
    await page.keyboard.press('ControlOrMeta+A')
    await runEditorCommand(page, 'toggleStrike')
    await expect.poll(() => isMarkActive(page, 'strike')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Undo / redo
  // -------------------------------------------------------------------------

  test('undo via Cmd+Z', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('undo me')

    await expect.poll(async () => {
      const markdown = await getEditorMarkdown(page)
      return markdown.includes('undo me')
    }).toBe(true)

    await page.keyboard.press('ControlOrMeta+Z')

    await expect.poll(async () => {
      const markdown = await getEditorMarkdown(page)
      return !markdown.includes('undo me')
    }).toBe(true)
  })

  test('redo via Cmd+Shift+Z', async () => {
    await setEditorContent(page, '<p></p>')
    await page.click(selectors.editor)
    await page.keyboard.type('redo me')

    await expect.poll(async () => {
      const markdown = await getEditorMarkdown(page)
      return markdown.includes('redo me')
    }).toBe(true)

    // Undo to remove the typed text
    await page.keyboard.press('ControlOrMeta+Z')

    await expect.poll(async () => {
      const markdown = await getEditorMarkdown(page)
      return !markdown.includes('redo me')
    }).toBe(true)

    // Redo to restore
    await page.keyboard.press('ControlOrMeta+Shift+Z')

    await expect.poll(async () => {
      const markdown = await getEditorMarkdown(page)
      return markdown.includes('redo me')
    }).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Select all
  // -------------------------------------------------------------------------

  test('select all via Cmd+A', async () => {
    await setEditorContent(page, '<p>First paragraph</p><p>Second paragraph</p>')
    await page.click(selectors.editor)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('replacement text')

    await expect.poll(async () => {
      const markdown = await getEditorMarkdown(page)
      return markdown.includes('replacement text') &&
        !markdown.includes('First paragraph') &&
        !markdown.includes('Second paragraph')
    }).toBe(true)
  })
})
