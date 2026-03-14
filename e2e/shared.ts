/**
 * Platform-agnostic test helpers shared between Electron and web Playwright tests.
 *
 * No Electron imports — safe for browser-only test configs.
 */

import type { Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Selectors — single source of truth for all test tiers
// ---------------------------------------------------------------------------

export const selectors = {
  editor: '.ProseMirror',
  editorContent: '.prose-editor',
  emptyState: '[data-testid="empty-state"]',
  chatInput: 'textarea',
  fileList: '[data-testid="file-list"]',
  toolbar: '[data-testid="toolbar"]',
  fileListPanel: '[data-testid="file-list-panel"]',
  showFilesButton: '[aria-label="Show files"], [aria-label="Hide files"]',

  // File explorer tabs
  recentFilesButton: '[aria-label="Recent files"]',
  filesButton: '[aria-label="Files"]',
  googleDocsButton: '[aria-label="Google Docs"]',
  notebooksButton: '[aria-label="reMarkable notebooks"]',

  // Toolbar buttons
  toggleTheme: '[aria-label="Toggle theme"]',
  copyMarkdown: '[aria-label="Copy Markdown"]',
  sourceMode: '[aria-label="Source mode"], [aria-label="WYSIWYG mode"]',
  hideAnnotations:
    '[aria-label="Hide AI annotations"], [aria-label="Show AI annotations"]',
  moreOptions: '[aria-label="More options"]',
  toggleChat: '[aria-label="Show chat"], [aria-label="Hide chat"]',

  // Editor modes
  sourceEditor: '.cm-editor',

  // Context menu (Radix UI)
  contextMenu: '[role="menu"]',
  contextMenuItem: '[role="menuitem"]',

  // Chat panel
  chatToggle: '[aria-label="Show chat"], [aria-label="Hide chat"]',
  newChatButton: '[aria-label="New chat"]',
  clearChatButton: '[aria-label="Clear chat"]',

  // Tab bar
  closeTab: '[aria-label="Close tab"]',
  newTabButton: '[aria-label="New tab"]',
} as const

// ---------------------------------------------------------------------------
// App-level helpers
// ---------------------------------------------------------------------------

/**
 * Dismiss the AI consent dialog that appears on first launch (no settings).
 * Clicks "Use Without AI" if the dialog is visible; does nothing otherwise.
 */
export async function dismissConsentDialog(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Use Without AI' })
  const visible = await btn.isVisible({ timeout: 3_000 }).catch(() => false)
  if (visible) {
    // Use force: true because DefaultHandlerPrompt's overlay may stack on top
    // and intercept pointer events before the consent dialog's button.
    await btn.click({ force: true })
    // Wait for the overlay to disappear
    await page.waitForSelector('[data-state="open"][aria-hidden="true"]', {
      state: 'detached',
      timeout: 3_000,
    }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Editor interaction helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the TipTap editor to be mounted and ready.
 *
 * The editor instance is exposed as `window.__prose_editor` by the renderer.
 * Note: this reference becomes `null` after a file close, so callers should
 * re-call `waitForEditor` if they reopen a document.
 */
export async function waitForEditor(page: Page): Promise<void> {
  await page.waitForSelector(selectors.editor, { state: 'attached', timeout: 10_000 })
}

/** Get the editor's JSON document via window.editor. */
export async function getEditorJSON(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    return editor?.getJSON() ?? null
  })
}

/** Get the editor's markdown content. */
export async function getEditorMarkdown(page: Page): Promise<string> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    return editor?.storage?.markdown?.getMarkdown() ?? ''
  })
}

/** Set the editor content via TipTap commands (bypasses input pipeline). */
export async function setEditorContent(page: Page, html: string): Promise<void> {
  await page.evaluate((content) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    editor?.commands.setContent(content)
  }, html)
}

/** Type into the editor using real keyboard events (goes through ProseMirror). */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  await page.click(selectors.editor)
  await page.keyboard.type(text)
}

/** Check if the editor is in the empty state (no document open). */
export async function isEmptyState(page: Page): Promise<boolean> {
  const placeholder = await page.locator(selectors.editor).getAttribute('data-placeholder')
  const text = await page.locator(selectors.editor).innerText()
  return text.trim() === '' && placeholder !== null
}

/** Run a TipTap chain command (e.g., toggleBold, toggleItalic). */
export async function runEditorCommand(page: Page, command: string): Promise<void> {
  await page.evaluate((cmd) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    if (editor) {
      const chain = editor.chain().focus()
      if (typeof chain[cmd] === 'function') {
        chain[cmd]().run()
      }
    }
  }, command)
}

// ---------------------------------------------------------------------------
// Onboarding helpers
// ---------------------------------------------------------------------------

/**
 * Dismiss onboarding dialogs that appear on first launch (or after reload).
 *
 * 1. DefaultHandlerPrompt ("Make Prose Your Default Markdown Editor") — 1 s delay after React mount
 * 2. AIConsentDialog   ("AI Writing Assistance")
 *
 * On CI, React can take 2-3 s to mount after domcontentloaded, so the first
 * dialog may not appear until 3-4 s in. Use generous timeouts and verify the
 * overlay is fully gone before returning.
 */
export async function dismissOnboarding(page: Page): Promise<void> {
  const gotIt = page.getByRole('button', { name: 'Got It' })
  if (await gotIt.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await gotIt.click()
  }

  const useWithoutAI = page.getByRole('button', { name: 'Use Without AI' })
  if (await useWithoutAI.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await useWithoutAI.click()
  }

  // Ensure no dialog overlay remains (catches slow animations or unexpected dialogs)
  const overlay = page.locator('[data-state="open"].fixed.inset-0')
  if (await overlay.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await page.keyboard.press('Escape')
    await overlay.waitFor({ state: 'detached', timeout: 2_000 }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// File explorer helpers
// ---------------------------------------------------------------------------

/** Ensure the file list panel is visible, opening it if necessary. */
export async function ensureFileListOpen(page: Page): Promise<void> {
  const panel = page.locator(selectors.fileListPanel)
  if (!(await panel.isVisible())) {
    await page.click(selectors.showFilesButton)
    await page.waitForSelector(selectors.fileListPanel, { timeout: 5_000 })
  }
}

/** Switch the file explorer to a specific tab. */
export async function switchExplorerTab(
  page: Page,
  tab: 'recent' | 'files' | 'googledocs' | 'notebooks',
): Promise<void> {
  await ensureFileListOpen(page)
  const buttonMap = {
    recent: selectors.recentFilesButton,
    files: selectors.filesButton,
    googledocs: selectors.googleDocsButton,
    notebooks: selectors.notebooksButton,
  }
  await page.click(buttonMap[tab])
}

// ---------------------------------------------------------------------------
// File interaction helpers
// ---------------------------------------------------------------------------

/** Open a file from the explorer by its display name. */
export async function openFileFromExplorer(page: Page, filename: string): Promise<void> {
  await ensureFileListOpen(page)
  const panel = page.locator(selectors.fileListPanel)
  await panel.getByText(filename).click()
  await waitForEditor(page)
}

/** Create a new document via More Options → New Document. */
export async function createNewDocument(page: Page): Promise<void> {
  // Dismiss any open menus/dialogs first
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)

  await page.click(selectors.moreOptions)
  const menuItem = page.getByRole('menuitem', { name: 'New Document' })
  await menuItem.waitFor({ state: 'visible', timeout: 5_000 })
  await menuItem.click()
  await waitForEditor(page)
}

/** Right-click on a file in the explorer to open its context menu. */
export async function rightClickFile(page: Page, filename: string): Promise<void> {
  await ensureFileListOpen(page)
  const panel = page.locator(selectors.fileListPanel)
  await panel.getByText(filename).click({ button: 'right' })
  await page.waitForSelector(selectors.contextMenu, { timeout: 3_000 })
}

// ---------------------------------------------------------------------------
// Chat helpers
// ---------------------------------------------------------------------------

/** Open the chat panel if not already open. */
export async function openChat(page: Page): Promise<void> {
  const showBtn = page.locator('[aria-label="Show chat"]')
  if (await showBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await showBtn.click()
  }
  // Wait for textarea to appear in the chat panel
  await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 3_000 })
}

/** Close the chat panel if open. */
export async function closeChat(page: Page): Promise<void> {
  const hideBtn = page.locator('[aria-label="Hide chat"]')
  if (await hideBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await hideBtn.click()
  }
}

/** Wait for the mock LLM stream to complete. */
export async function waitForChatResponse(page: Page): Promise<void> {
  // The mock LLM fires llm:stream:complete after 50ms.
  // Wait for a message bubble from the assistant to appear.
  await page.waitForFunction(
    () => {
      const msgs = document.querySelectorAll('.prose-chat-message, [class*="chat"] [class*="message"]')
      return msgs.length > 0
    },
    { timeout: 5_000 },
  ).catch(() => {
    // Fallback: just wait a reasonable time for the stream to complete
  })
  // Give the UI a moment to render the response
  await page.waitForTimeout(200)
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

/**
 * Pre-seed web mode settings to suppress onboarding dialogs.
 * Extracted from web.spec.ts for reuse across test files.
 */
export async function preseedSettings(page: Page): Promise<void> {
  await page.goto('/web-index.html')
  await page.evaluate(() => {
    const settings = {
      fileAssociation: { hasBeenPrompted: true },
      aiConsent: { consented: false, consentedAt: new Date().toISOString(), version: 1 },
    }
    localStorage.setItem('prose:web-mode-settings', JSON.stringify(settings))
  })
  await page.reload()
  await page.waitForLoadState('networkidle')
}

/** Check if a TipTap mark is currently active. */
export async function isMarkActive(page: Page, mark: string): Promise<boolean> {
  return page.evaluate((m) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    return editor?.isActive(m) ?? false
  }, mark)
}

/** Check if a TipTap node type is currently active. */
export async function isNodeActive(page: Page, node: string, attrs?: Record<string, unknown>): Promise<boolean> {
  return page.evaluate(({ n, a }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    return editor?.isActive(n, a) ?? false
  }, { n: node, a: attrs })
}
