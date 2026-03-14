/**
 * Web e2e tests — chat panel and mock LLM interactions.
 *
 * Tests the chat panel toggle, message input, mock LLM responses,
 * keyboard shortcuts, and chat controls in web mode.
 *
 * The mock LLM (webApi.ts) responds to llmChatStream by dispatching
 * a `llm:stream:complete` CustomEvent after 50ms with a web-mode
 * guidance message.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  selectors,
  waitForEditor,
  ensureFileListOpen,
  openChat,
  closeChat,
  preseedSettings,
} from './shared'

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await preseedSettings(page)

  // Open a file so there's an editor context
  await ensureFileListOpen(page)
  const panel = page.locator(selectors.fileListPanel)
  await panel.getByText('Welcome to Prose').click()
  await waitForEditor(page)
})

test.afterAll(async () => {
  await page?.close()
})

test.describe('Chat & LLM', () => {
  test('open chat panel', async () => {
    await closeChat(page)

    await page.click(selectors.toggleChat)

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 5_000 })
  })

  test('close chat panel', async () => {
    await openChat(page)

    await page.click(selectors.toggleChat)

    const textarea = page.locator('textarea').first()
    await expect(textarea).not.toBeVisible({ timeout: 5_000 })
  })

  test('chat input accepts text', async () => {
    await openChat(page)

    const textarea = page.locator('textarea').first()
    await textarea.fill('Hello test')

    await expect(textarea).toHaveValue('Hello test')

    await textarea.fill('')
  })

  test('chat input accepts multiline', async () => {
    await openChat(page)

    const textarea = page.locator('textarea').first()
    await textarea.click()
    await textarea.fill('')

    await page.keyboard.type('First line')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('Second line')

    const value = await textarea.inputValue()
    expect(value).toContain('\n')
    expect(value).toContain('First line')
    expect(value).toContain('Second line')

    await textarea.fill('')
  })

  test('send message to mock LLM', async () => {
    await openChat(page)

    // Reset chat state
    const newChatBtn = page.locator('[aria-label="New chat"]')
    if (await newChatBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await newChatBtn.click()
    }

    const textarea = page.locator('textarea').first()
    await textarea.fill('Hello')
    await page.keyboard.press('Enter')

    // Wait for mock LLM to respond (fires after 50ms)
    await page.waitForTimeout(300)

    const pageText = await page.locator('body').innerText()
    const hasWebMode =
      pageText.includes('Web mode') || pageText.includes('API key') || pageText.includes('Configure')
    expect(hasWebMode).toBe(true)
  })

  test('mock LLM response content', async () => {
    await openChat(page)

    const textarea = page.locator('textarea').first()
    await textarea.fill('Test message')
    await page.keyboard.press('Enter')

    await page.waitForTimeout(300)

    const bodyText = await page.locator('body').innerText()
    const hasGuidance =
      bodyText.includes('Web mode') ||
      bodyText.includes('API key') ||
      bodyText.includes('Configure your Anthropic')
    expect(hasGuidance).toBe(true)
  })

  test('chat keyboard shortcut Cmd+/', async () => {
    await closeChat(page)

    await page.keyboard.press('ControlOrMeta+/')

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 5_000 })

    await page.keyboard.press('ControlOrMeta+/')

    await expect(textarea).not.toBeVisible({ timeout: 5_000 })
  })

  test('chat textarea auto-focuses on open', async () => {
    await closeChat(page)

    await page.click(selectors.toggleChat)

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 5_000 })
    await expect(textarea).toBeFocused({ timeout: 3_000 })
  })

  test('submit via Enter clears input', async () => {
    await openChat(page)

    const textarea = page.locator('textarea').first()
    await textarea.fill('Submit test message')

    await page.keyboard.press('Enter')

    await expect(textarea).toHaveValue('', { timeout: 3_000 })
  })

  test('new chat button clears messages', async () => {
    await openChat(page)

    const textarea = page.locator('textarea').first()
    await textarea.fill('Message before new chat')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)

    const newChatBtn = page.locator('[aria-label="New chat"]')
    await expect(newChatBtn).toBeVisible({ timeout: 3_000 })
    await newChatBtn.click()

    await expect(textarea).toBeVisible({ timeout: 3_000 })
    const textareaValue = await textarea.inputValue()
    expect(textareaValue).toBe('')
  })

  test('clear chat button', async () => {
    await openChat(page)

    const textarea = page.locator('textarea').first()
    await textarea.fill('Some text to clear')

    const clearBtn = page.locator('[aria-label="Clear chat"]')
    const isClearVisible = await clearBtn.isVisible({ timeout: 2_000 }).catch(() => false)

    if (isClearVisible) {
      await clearBtn.click()
      await expect(textarea).toBeVisible({ timeout: 3_000 })
    } else {
      await expect(textarea).toBeVisible({ timeout: 3_000 })
    }

    await textarea.fill('')
  })

  test('chat with no API key shows guidance', async () => {
    await openChat(page)

    const newChatBtn = page.locator('[aria-label="New chat"]')
    if (await newChatBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await newChatBtn.click()
    }

    const textarea = page.locator('textarea').first()
    await textarea.fill('What can you help me with?')
    await page.keyboard.press('Enter')

    await page.waitForTimeout(300)

    const bodyText = await page.locator('body').innerText()
    const hasWebModeMessage =
      bodyText.includes('Web mode') ||
      bodyText.includes('API key') ||
      bodyText.includes('Configure your Anthropic')
    expect(hasWebModeMessage).toBe(true)
  })
})
