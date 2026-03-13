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
} as const

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
 * 1. DefaultHandlerPrompt ("Make Prose Your Default Markdown Editor") — 1 s delay
 * 2. AIConsentDialog   ("AI Writing Assistance")
 */
export async function dismissOnboarding(page: Page): Promise<void> {
  const gotIt = page.getByRole('button', { name: 'Got It' })
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await gotIt.click()
  }

  const useWithoutAI = page.getByRole('button', { name: 'Use Without AI' })
  if (await useWithoutAI.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await useWithoutAI.click()
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
