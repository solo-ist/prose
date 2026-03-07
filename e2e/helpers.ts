/**
 * Shared test helpers for Playwright Electron tests.
 *
 * These helpers are consumed by both CI (Playwright CLI) and local dev
 * (Circuit Electron MCP). They wrap common patterns for interacting with
 * the TipTap editor, toolbar, and app chrome.
 */

import { type ElectronApplication, type Page, _electron as electron } from '@playwright/test'
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers'
import { existsSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Selectors — single source of truth for both tiers
// ---------------------------------------------------------------------------

export const selectors = {
  editor: '.ProseMirror',
  editorContent: '.prose-editor',
  emptyState: '[data-testid="empty-state"]',
  chatInput: 'textarea',
  fileList: '[data-testid="file-list"]',
  toolbar: '[data-testid="toolbar"]',
} as const

// ---------------------------------------------------------------------------
// Launch helpers
// ---------------------------------------------------------------------------

/**
 * Launch the Electron app for testing.
 *
 * In CI, launches from the built output (requires `npm run build` first).
 * Locally, can optionally launch from source via electron-vite dev.
 */
export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const projectRoot = resolve(__dirname, '..')

  // Try to find a packaged build first (electron-builder output)
  let appPath: string
  try {
    appPath = findLatestBuild(projectRoot)
    console.log(`[e2e] Using packaged build: ${appPath}`)
  } catch {
    // No packaged build — launch from source using electron-vite output
    appPath = resolve(projectRoot, 'out/main/index.js')
    if (!existsSync(appPath)) {
      throw new Error(
        `Build output not found at ${appPath}. Run "npm run build" before running tests.`,
      )
    }
    console.log(`[e2e] Using dev build: ${appPath}`)
  }

  // Determine if we're launching a packaged app or from source
  const isPackaged = !appPath.endsWith('.js')

  let app: ElectronApplication

  if (isPackaged) {
    const appInfo = parseElectronApp(appPath)
    app = await electron.launch({
      executablePath: appInfo.executable,
      args: [appInfo.main],
    })
  } else {
    app = await electron.launch({
      args: [appPath],
    })
  }

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return { app, page }
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
  // When empty, TipTap shows the placeholder "Start writing..."
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
