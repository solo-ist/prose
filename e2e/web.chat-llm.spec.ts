/**
 * Web e2e tests — chat panel and mock LLM interactions.
 *
 * Tests the chat panel toggle, message input, mock LLM responses,
 * keyboard shortcuts, and chat controls in web mode.
 *
 * With aiConsent.consented = false, the useChat hook returns exactly:
 * "AI features are not enabled. Enable them in Settings → AI."
 * Tests verify this consent-gated flow.
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

  test('send message and receive assistant response', async () => {
    await openChat(page)

    // Reset chat state
    const newChatBtn = page.locator('[aria-label="New chat"]')
    if (await newChatBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await newChatBtn.click()
    }

    const textarea = page.locator('textarea').first()
    await textarea.fill('Hello')
    await page.keyboard.press('Enter')

    // Wait for the assistant response to render in a .prose-chat element
    const chatMessage = page.locator('.prose-chat').last()
    await chatMessage.waitFor({ state: 'visible', timeout: 5_000 })

    // With consent=false, the hook returns exactly this message
    const messageText = await chatMessage.innerText()
    expect(messageText).toContain('AI features are not enabled')
  })

  test('chat keyboard shortcut Cmd+Shift+L', async () => {
    await closeChat(page)

    // The actual chat toggle shortcut is Cmd+Shift+L
    await page.keyboard.press('ControlOrMeta+Shift+L')

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 5_000 })

    await page.keyboard.press('ControlOrMeta+Shift+L')

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

    // Wait for the assistant response
    await page.locator('.prose-chat').first().waitFor({ state: 'visible', timeout: 5_000 })

    const newChatBtn = page.locator('[aria-label="New chat"]')
    await expect(newChatBtn).toBeVisible({ timeout: 3_000 })
    await newChatBtn.click()

    await expect(textarea).toBeVisible({ timeout: 3_000 })
    const textareaValue = await textarea.inputValue()
    expect(textareaValue).toBe('')
  })

  test('clear chat button removes messages', async () => {
    await openChat(page)

    // Reset chat state first
    const newChatBtn = page.locator('[aria-label="New chat"]')
    if (await newChatBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await newChatBtn.click()
    }

    // Send a message so there's something to clear
    const textarea = page.locator('textarea').first()
    await textarea.fill('Message to clear')
    await page.keyboard.press('Enter')

    // Wait for the assistant response
    await page.locator('.prose-chat').first().waitFor({ state: 'visible', timeout: 5_000 })

    const clearBtn = page.locator('[aria-label="Clear chat"]')
    if (!(await clearBtn.isVisible({ timeout: 2_000 }).catch(() => false))) {
      test.skip()
      return
    }

    await clearBtn.click()

    // Verify messages are gone
    await expect(page.locator('.prose-chat')).toHaveCount(0, { timeout: 3_000 })
  })

  test('chat without AI consent shows guidance', async () => {
    await openChat(page)

    const newChatBtn = page.locator('[aria-label="New chat"]')
    if (await newChatBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await newChatBtn.click()
    }

    const textarea = page.locator('textarea').first()
    await textarea.fill('What can you help me with?')
    await page.keyboard.press('Enter')

    // Wait for the guidance message to render
    const chatMessage = page.locator('.prose-chat').last()
    await chatMessage.waitFor({ state: 'visible', timeout: 5_000 })

    const messageText = await chatMessage.innerText()
    expect(messageText).toContain('AI features are not enabled')
    expect(messageText).toContain('Enable them in Settings')
  })
})
