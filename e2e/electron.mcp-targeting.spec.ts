/**
 * MCP targeting and manners (#1237, M3 of #1230).
 *
 * An MCP client can name the open document a call acts on (`document`: a
 * documentId or path from list_tabs) instead of whatever tab the writer has in
 * front of them, and no MCP call moves the writer's caret, takes focus or
 * switches the tab (tab-changing tools aside). A document that isn't open is
 * refused, never reopened from disk on the client's say-so.
 *
 * Calls arrive the way the MCP bridge delivers them: `mcp:tool:invoke` sent
 * from the main process, the result read back off `mcp:tool:result`.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  executeProseTool,
  seedSettings,
  selectors,
} from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */

let app: ElectronApplication
let page: Page
let userDataDir: string
let docsDir: string
let callSeq = 0

interface TabInfo { tabId: string; title: string; path: string | null; documentId: string }
interface McpResult { success: boolean; data?: any; error?: string; code?: string }

test.describe('MCP targeting', () => {
  test.beforeEach(async () => {
    test.setTimeout(120_000)
    userDataDir = mkdtempSync(join(tmpdir(), 'prose-1237-'))
    docsDir = mkdtempSync(join(tmpdir(), 'prose-1237-docs-'))
    seedSettings(userDataDir, { defaultSaveDirectory: docsDir })
    const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9233' } })
    app = launched.app
    page = launched.page
    await waitForAppReady(page)
    await dismissOnboarding(page).catch(() => {})
    await dismissOverlay(page).catch(() => {})
    // Read the bridge's results off the same channel the bridge listens on.
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as any
      g.__mcpResults = new Map()
      ipcMain.on('mcp:tool:result', (_event: unknown, id: string, result: unknown) => g.__mcpResults.set(id, result))
    })
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(docsDir, { recursive: true, force: true })
  })

  /** One MCP tool call, delivered as the bridge delivers it. */
  async function mcp(name: string, args: Record<string, unknown>): Promise<McpResult> {
    const id = `mcp-1237-${++callSeq}`
    await app.evaluate(({ BrowserWindow }, call) => {
      BrowserWindow.getAllWindows()[0].webContents.send('mcp:tool:invoke', call.id, call.name, call.args)
    }, { id, name, args })
    let result: McpResult | undefined
    await expect.poll(async () => {
      result = await app.evaluate((_electron, requestId) => (globalThis as any).__mcpResults.get(requestId), id)
      return result !== undefined
    }, { timeout: 15_000 }).toBe(true)
    return result!
  }

  async function listTabs(): Promise<TabInfo[]> {
    const listed = await executeProseTool(page, 'list_tabs', {})
    return (listed.data as { tabs: TabInfo[] }).tabs
  }

  async function openDoc(name: string, content: string, firstLine: string): Promise<TabInfo> {
    const path = join(docsDir, name)
    writeFileSync(path, content)
    const opened = await executeProseTool(page, 'open_file', { path })
    expect(opened.success, `open_file ${name}: ${JSON.stringify(opened)}`).toBe(true)
    await waitForEditor(page)
    await expect.poll(docText).toContain(firstLine)
    return (await listTabs()).find((t) => t.title === name.replace(/\.md$/, ''))!
  }

  const docText = () => page.evaluate(() => (window as any).__prose_editor.state.doc.textContent as string)
  const activeTabId = () => page.evaluate(() => (window as any).__prose_tools.getActiveTabId() as string | null)
  const selection = () =>
    page.evaluate(() => {
      const { from, to } = (window as any).__prose_editor.state.selection
      return { from, to }
    })
  const activeThreads = () => page.evaluate(() => ((window as any).__prose_tools.getCommentStore() as unknown[]).length)
  const sessionThreads = (tabId: string) =>
    page.evaluate((id) => ((window as any).__prose_tools.getSessionThreads(id)?.threads ?? []).length as number, tabId)
  const sessionSuggestions = (tabId: string) =>
    page.evaluate((id) => ((window as any).__prose_tools.getSessionState(id)?.suggestionIds ?? []).length as number, tabId)

  /** A node id in a document, read through MCP (targeted when `document` is given). */
  async function nodeIdOf(text: string, document?: string): Promise<string> {
    const read = await mcp('read_document', document ? { document } : {})
    expect(read.success, JSON.stringify(read)).toBe(true)
    const node = (read.data.nodes as Array<{ id: string; content?: string }>).find((n) => (n.content ?? '').includes(text))
    expect(node, `node "${text}"`).toBeTruthy()
    return node!.id
  }

  test('a call targets a background document by id or path; the writer’s tab, caret and records stay put', async () => {
    const a = await openDoc('alpha.md', 'Alpha one.\n\nAlpha two.\n', 'Alpha one.')
    const b = await openDoc('bravo.md', 'Bravo one.\n\nBravo two.\n', 'Bravo one.')
    expect(await activeTabId()).toBe(b.tabId)
    await page.evaluate(() => (window as any).__prose_editor.commands.setTextSelection({ from: 3, to: 7 }))
    const caret = await selection()

    // read_document on a background target returns that document, not the shown one.
    const alphaTwo = await nodeIdOf('Alpha two.', a.documentId)

    const commented = await mcp('add_comment', { document: a.documentId, nodeId: alphaTwo, comment: 'For Alpha' })
    expect(commented.success, JSON.stringify(commented)).toBe(true)
    await expect.poll(() => sessionThreads(a.tabId)).toBe(1)

    const alphaOne = await nodeIdOf('Alpha one.', a.path!)
    const suggested = await mcp('suggest_edit', { document: a.path, nodeId: alphaOne, content: 'Alpha one, revised.' })
    expect(suggested.success, JSON.stringify(suggested)).toBe(true)
    await expect.poll(() => sessionSuggestions(a.tabId)).toBe(1)

    expect(await activeTabId()).toBe(b.tabId)
    expect(await docText()).toContain('Bravo one.')
    expect(await selection()).toEqual(caret)
    expect(await activeThreads()).toBe(0)
    expect(await sessionSuggestions(b.tabId)).toBe(0)
  })

  test('a document that is not open is refused, and nothing opens', async () => {
    await openDoc('bravo.md', 'Bravo one.\n', 'Bravo one.')
    const closedPath = join(docsDir, 'closed.md')
    writeFileSync(closedPath, 'Closed one.\n')
    const before = (await listTabs()).length

    const refused = await mcp('add_comment', { document: closedPath, nodeId: 'n-anything', comment: 'Nope' })
    expect(refused.success).toBe(false)
    expect(refused.code).toBe('DOCUMENT_NOT_OPEN')
    expect((await listTabs()).length).toBe(before)
    expect(await activeThreads()).toBe(0)
  })

  test('an untargeted call keeps the writer’s caret and focus', async () => {
    await openDoc('bravo.md', 'Bravo one.\n\nBravo two.\n', 'Bravo one.')
    await page.evaluate(() => (window as any).__prose_editor.commands.setTextSelection({ from: 2, to: 5 }))
    const caret = await selection()

    // The writer is typing in the chat input when the call lands.
    const chatInput = page.locator(selectors.chatInput).first()
    if (!(await chatInput.isVisible().catch(() => false))) await page.keyboard.press('ControlOrMeta+Shift+L')
    await chatInput.click()
    await chatInput.fill('half a thought')
    const focusedBefore = await page.evaluate(() => document.activeElement?.tagName ?? null)
    expect(focusedBefore).toBe('TEXTAREA')

    const bravoTwo = await nodeIdOf('Bravo two.')
    const commented = await mcp('add_comment', { nodeId: bravoTwo, comment: 'On the shown tab' })
    expect(commented.success, JSON.stringify(commented)).toBe(true)
    await expect.poll(activeThreads).toBe(1)

    expect(await selection()).toEqual(caret)
    expect(await page.evaluate(() => document.activeElement?.tagName ?? null)).toBe('TEXTAREA')
    await expect(chatInput).toHaveValue('half a thought')
  })
})
