/**
 * Suggesting mode (#891, P3 of #1230; design: docs/architecture/suggesting-mode.md).
 *
 * The writer turns Suggesting on for a tab and edits: typing, Backspace,
 * IME composition, paste, drag and undo all become tracked changes, and the
 * file on disk keeps the original until a change is accepted. The changes
 * survive a relaunch on their context, and one whose context the file lost
 * is set aside, not put back somewhere wrong. Agents propose the same way
 * over MCP (suggest_insert, suggest_delete) and never decide.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
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
} from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */

let app: ElectronApplication
let page: Page
let userDataDir: string
let docsDir: string
let callSeq = 0

const DOC = 'Alpha beta gamma.\n\nDelta epsilon zeta.\n'

interface Change {
  id: string
  type: 'insertion' | 'deletion' | 'edit'
  deletedText: string
  insertedText: string
  actor: { kind: string }
}

async function launch(): Promise<void> {
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9253' } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
}

async function openDoc(name: string, text = DOC): Promise<string> {
  const path = join(docsDir, name)
  writeFileSync(path, text)
  const opened = await executeProseTool(page, 'open_file', { path })
  expect(opened.success, JSON.stringify(opened)).toBe(true)
  await waitForEditor(page)
  await expect.poll(docText).toContain('Delta')
  return path
}

const docText = () => page.evaluate(() => (window as any).__prose_editor.state.doc.textContent as string)
const tracked = () => page.evaluate(() => (window as any).__prose_tools.getTrackedChanges() as Change[])
const isDirty = () => page.evaluate(() => (window as any).__prose_tools.getDocumentIsDirty() as boolean)
const reviewLog = () => page.evaluate(() => (window as any).__prose_tools.getReviewLog())

async function turnOnSuggesting(): Promise<void> {
  await page.locator('[data-testid="status-suggesting"]').click()
  await expect(page.locator('[data-testid="status-suggesting"]')).toHaveText('Suggesting')
  expect(await page.evaluate(() => (window as any).__prose_tools.isSuggesting())).toBe(true)
}

/** Focus the editor the way the writer does: a click on the paragraph that holds `text`. */
async function focusOn(text: string): Promise<void> {
  await page.locator('.ProseMirror p', { hasText: text }).first().click()
}

/** The caret right after the first occurrence of `text`, the editor focused. */
async function caretAfter(text: string): Promise<void> {
  await focusOn(text)
  await page.evaluate((needle) => {
    const editor = (window as any).__prose_editor
    let at = -1
    editor.state.doc.descendants((node: any, pos: number) => {
      if (at === -1 && node.isText && node.text.includes(needle)) at = pos + node.text.indexOf(needle) + needle.length
      return at === -1
    })
    if (at === -1) throw new Error(`no "${needle}"`)
    editor.commands.setTextSelection(at)
  }, text)
}

async function selectText(text: string): Promise<void> {
  await focusOn(text)
  await page.evaluate((needle) => {
    const editor = (window as any).__prose_editor
    let at = -1
    editor.state.doc.descendants((node: any, pos: number) => {
      if (at === -1 && node.isText && node.text.includes(needle)) at = pos + node.text.indexOf(needle)
      return at === -1
    })
    if (at === -1) throw new Error(`no "${needle}"`)
    editor.commands.setTextSelection({ from: at, to: at + needle.length })
  }, text)
}

/** Every pending projection and record write lands (the 500 ms delay, with room). */
const settle = () => page.waitForTimeout(800)

test.describe('Suggesting mode', () => {
  test.beforeEach(async () => {
    test.setTimeout(120_000)
    userDataDir = mkdtempSync(join(tmpdir(), 'prose-891-'))
    docsDir = mkdtempSync(join(tmpdir(), 'prose-891-docs-'))
    seedSettings(userDataDir, { defaultSaveDirectory: docsDir })
    await launch()
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(docsDir, { recursive: true, force: true })
  })

  test('typing and Backspace become tracked changes; the file keeps the original until an accept', async () => {
    const path = await openDoc('save.md')
    await turnOnSuggesting()

    await caretAfter('gamma')
    await page.keyboard.type(' delta')
    await caretAfter('zeta')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await settle()

    const changes = await tracked()
    expect(changes.map((c) => [c.type, c.insertedText, c.deletedText, c.actor.kind])).toEqual([
      ['insertion', ' delta', '', 'human'],
      ['deletion', '', 'ta', 'human'],
    ])
    // The text is all still there: inserted and struck.
    expect(await docText()).toBe('Alpha beta gamma delta.Delta epsilon zeta.')
    expect(await isDirty()).toBe(false)

    // A save writes the original, byte for byte.
    await page.keyboard.press('Meta+s')
    await settle()
    expect(readFileSync(path, 'utf8')).toBe(DOC)

    // An accept changes the original: the tab goes dirty and the save carries it.
    await page.evaluate((id) => (window as any).__prose_editor.commands.acceptTrackedChange(id), changes[0].id)
    await expect.poll(isDirty).toBe(true)
    await page.keyboard.press('Meta+s')
    // An edited body serializes without a final newline, as every save does (#1105).
    await expect.poll(() => readFileSync(path, 'utf8')).toBe('Alpha beta gamma delta.\n\nDelta epsilon zeta.')
  })

  test('IME composition lands as one tracked insertion', async () => {
    await openDoc('ime.md')
    await turnOnSuggesting()
    await caretAfter('gamma')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'k', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.imeSetComposition', { text: 'かな', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.insertText', { text: 'かな' })
    await settle()
    expect(await docText()).toBe('Alpha beta gammaかな.Delta epsilon zeta.')
    const changes = await tracked()
    expect(changes.map((c) => [c.type, c.insertedText])).toEqual([['insertion', 'かな']])
  })

  test('a paste is tracked, and ⌘Z takes a tracked edit back whole', async () => {
    await openDoc('paste.md')
    await turnOnSuggesting()
    await caretAfter('Alpha')
    await page.evaluate((text) => {
      const target = document.querySelector('.ProseMirror')!
      const data = new DataTransfer()
      data.setData('text/plain', text)
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: data })
      target.dispatchEvent(event)
    }, ' pasted')
    await expect.poll(async () => (await tracked()).map((c) => c.insertedText)).toEqual([' pasted'])

    await selectText('beta')
    await page.keyboard.type('BETA')
    expect((await tracked()).map((c) => [c.type, c.deletedText, c.insertedText])).toEqual([
      ['insertion', '', ' pasted'],
      ['edit', 'beta', 'BETA'],
    ])

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => (await tracked()).length).toBe(1)
    expect(await docText()).toBe('Alpha pasted beta gamma.Delta epsilon zeta.')
  })

  test('a drag inside the text becomes a deletion at the source and an insertion at the target', async () => {
    await openDoc('drag.md')
    await turnOnSuggesting()
    await selectText('beta ')
    await page.evaluate(() => {
      const view = (window as any).__prose_editor.view
      const { from, to } = view.state.selection
      const start = view.coordsAtPos(from + 1)
      let target = -1
      view.state.doc.descendants((node: any, pos: number) => {
        if (target === -1 && node.isText && node.text.includes('epsilon')) target = pos + node.text.indexOf('epsilon')
        return target === -1
      })
      const end = view.coordsAtPos(target)
      const data = new DataTransfer()
      const at = (type: string, c: { left: number; top: number; bottom: number }, dom: Element) =>
        dom.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: c.left + 1, clientY: (c.top + c.bottom) / 2, dataTransfer: data }))
      const startDom = view.domAtPos(from + 1).node.parentElement
      at('dragstart', start, startDom)
      at('dragover', end, view.dom)
      at('drop', end, view.dom)
      if (to < from) throw new Error('unreachable')
    })
    await expect.poll(async () => (await tracked()).map((c) => [c.type, c.deletedText || c.insertedText])).toEqual([
      ['deletion', 'beta '],
      ['insertion', 'beta '],
    ])
    expect(await docText()).toBe('Alpha beta gamma.Delta beta epsilon zeta.')
  })

  test('the changes come back on their context after a relaunch, Suggesting still on', async () => {
    const path = await openDoc('relaunch.md')
    await turnOnSuggesting()
    await caretAfter('gamma')
    await page.keyboard.type(' delta')
    await selectText('epsilon')
    await page.keyboard.press('Backspace')
    await settle()
    const before = await tracked()
    expect(before).toHaveLength(2)

    await page.waitForTimeout(1_200)
    await app.close()
    await launch()
    await waitForEditor(page)
    await expect.poll(async () => (await tracked())?.length ?? 0).toBe(2)
    const after = await tracked()
    expect(after.map((c) => [c.id, c.type, c.insertedText, c.deletedText])).toEqual(before.map((c) => [c.id, c.type, c.insertedText, c.deletedText]))
    expect(await page.evaluate(() => (window as any).__prose_tools.isSuggesting())).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe(DOC)
  })

  test('a change whose context changed outside Prose is set aside, not put back', async () => {
    const path = await openDoc('orphan.md')
    await turnOnSuggesting()
    await selectText('beta')
    await page.keyboard.type('BETA')
    await caretAfter('zeta')
    await page.keyboard.type(' eta')
    await settle()
    const [replaced, kept] = (await tracked()).map((c) => c.id)

    await page.waitForTimeout(1_200)
    await app.close()
    // Someone edits the first paragraph while Prose is closed.
    writeFileSync(path, 'Alpha beta, gamma!\n\nDelta epsilon zeta.\n')
    await launch()
    await waitForEditor(page)
    await expect.poll(docText).toContain('gamma!')
    await expect.poll(async () => (await tracked())?.map((c) => c.id)).toEqual([kept])
    expect(await docText()).toBe('Alpha beta, gamma!Delta epsilon zeta eta.')
    const log = await reviewLog()
    expect(log.suggestions.find((s: any) => s.id === replaced)).toMatchObject({ status: 'superseded', orphaned: true })
    expect(log.events.map((e: any) => e.kind)).toContain('suggestion:orphaned')
  })

  test('the display controls switch the CSS, never the document', async () => {
    await openDoc('display.md')
    await turnOnSuggesting()
    await selectText('beta')
    await page.keyboard.type('BETA')
    const text = await docText()
    const shown = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).display)
    const underline = () => page.locator('ins.tracked-insert').first().evaluate((el) => getComputedStyle(el).textDecorationLine)

    expect(await shown('del.tracked-delete')).not.toBe('none')
    expect(await underline()).toContain('underline')

    // The menu settles open before a pick, and is gone before the next open.
    const choose = async (value: string) => {
      await expect(page.locator('[role="menu"]')).toHaveCount(0)
      await page.locator('[data-testid="tracked-display"]').click()
      const item = page.locator(`[data-testid="tracked-display-${value}"]`)
      await expect(item).toBeVisible()
      await page.waitForTimeout(250)
      await item.click()
    }
    await choose('no-deletions')
    await expect(page.locator('.prose-editor')).toHaveClass(/tracked-display-no-deletions/)
    expect(await shown('del.tracked-delete')).toBe('none')
    expect(await underline()).toContain('underline')

    await choose('final')
    await expect(page.locator('.prose-editor')).toHaveClass(/tracked-display-final/)
    expect(await shown('del.tracked-delete')).toBe('none')
    expect(await underline()).not.toContain('underline')

    expect(await docText()).toBe(text)
    expect((await tracked()).length).toBe(1)
  })

  test('a comment over a tracked deletion: rejected, the thread stays; accepted, the text goes and the thread resolves', async () => {
    await openDoc('comment.md')
    await turnOnSuggesting()
    await selectText('epsilon')
    await page.keyboard.press('Backspace')
    const [change] = await tracked()
    const range = await page.evaluate(() => {
      const editor = (window as any).__prose_editor
      let from = -1
      editor.state.doc.descendants((node: any, pos: number) => {
        if (from === -1 && node.isText && node.text.includes('epsilon')) from = pos + node.text.indexOf('epsilon')
        return from === -1
      })
      return { from, to: from + 'epsilon'.length }
    })
    const added = await executeProseTool(page, 'add_comment', { ...range, comment: 'Keep this word?' })
    expect(added.success, JSON.stringify(added)).toBe(true)
    const threads = () => page.evaluate(() => (window as any).__prose_tools.getCommentStore() as Array<{ id: string; resolved?: boolean }>)

    await page.evaluate((id) => (window as any).__prose_editor.commands.rejectTrackedChange(id), change.id)
    expect(await docText()).toContain('epsilon')
    expect((await threads())[0].resolved ?? false).toBe(false)

    await selectText('epsilon')
    await page.keyboard.press('Backspace')
    const [again] = await tracked()
    await page.evaluate((id) => (window as any).__prose_editor.commands.acceptTrackedChange(id), again.id)
    expect(await docText()).not.toContain('epsilon')
    await expect.poll(async () => (await threads())[0].resolved).toBe(true)
  })
})

test.describe('the tracked store (DB_VERSION 11)', () => {
  test.beforeEach(async () => {
    test.setTimeout(120_000)
    userDataDir = mkdtempSync(join(tmpdir(), 'prose-891-db-'))
    docsDir = mkdtempSync(join(tmpdir(), 'prose-891-db-docs-'))
    seedSettings(userDataDir, { defaultSaveDirectory: docsDir })
    await launch()
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(docsDir, { recursive: true, force: true })
  })

  const schema = () =>
    page.evaluate(
      () =>
        new Promise<{ version: number; stores: string[] }>((resolve) => {
          const open = indexedDB.open('prose-db')
          open.onsuccess = () => {
            resolve({ version: open.result.version, stores: Array.from(open.result.objectStoreNames) })
            open.result.close()
          }
        })
    )

  test('a fresh profile has it; a 1.9.1 profile (version 10) gains it and keeps its rows', async () => {
    expect(await schema()).toMatchObject({ version: 11, stores: expect.arrayContaining(['tracked', 'review_log']) })

    // The database as version 10 left it: every store but `tracked`, and a row.
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('prose-db')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('prose-db', 10)
        request.onupgradeneeded = () => {
          for (const store of ['drafts', 'conversations', 'annotations', 'command_history', 'suggestions', 'emoji_cache', 'summaries', 'comments', 'review_log']) {
            request.result.createObjectStore(store)
          }
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('review_log', 'readwrite')
          tx.objectStore('review_log').put({ suggestions: [], events: [], nextSeq: 7 }, 'doc-891')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      })
    })
    await app.close()
    await launch()
    expect(await schema()).toMatchObject({ version: 11, stores: expect.arrayContaining(['tracked', 'review_log']) })
    expect(await page.evaluate(() => (window as any).__prose_tools.loadReviewLogFromDB('doc-891'))).toMatchObject({ nextSeq: 7 })
    expect(await page.evaluate(() => (window as any).__prose_tools.loadTrackedFromDB('doc-891'))).toEqual([])
  })
})

test.describe('suggest_insert and suggest_delete over MCP', () => {
  test.beforeEach(async () => {
    test.setTimeout(120_000)
    userDataDir = mkdtempSync(join(tmpdir(), 'prose-891-mcp-'))
    docsDir = mkdtempSync(join(tmpdir(), 'prose-891-mcp-docs-'))
    seedSettings(userDataDir, { defaultSaveDirectory: docsDir })
    await launch()
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

  async function mcp(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const id = `mcp-891-${++callSeq}`
    await app.evaluate(({ BrowserWindow }, call) => {
      BrowserWindow.getAllWindows()[0].webContents.send('mcp:tool:invoke', call.id, call.name, call.args, {
        kind: 'mcp-agent',
        connectionId: 'c-891',
        connectionLabel: 'Codex laptop',
      })
    }, { id, name, args })
    let result: any
    await expect.poll(async () => {
      result = await app.evaluate((_electron, requestId) => (globalThis as any).__mcpResults.get(requestId), id)
      return result !== undefined
    }, { timeout: 15_000 }).toBe(true)
    return result
  }

  test('an agent proposes an insertion and a deletion; the writer decides; agents can’t', async () => {
    const path = await openDoc('mcp.md')
    // Another document in front: the calls target this one by its path.
    await executeProseTool(page, 'new_file', {})
    const read = await mcp('read_document', { document: path })
    expect(read.success, JSON.stringify(read)).toBe(true)
    const nodeId = (read.data.nodes as Array<{ id: string; content: string }>).find((n) => n.content.includes('epsilon'))!.id

    const inserted = await mcp('suggest_insert', { document: path, nodeId, search: 'epsilon', text: ' (new)' })
    expect(inserted.success, JSON.stringify(inserted)).toBe(true)
    const deleted = await mcp('suggest_delete', { document: path, nodeId, search: 'zeta' })
    expect(deleted.success, JSON.stringify(deleted)).toBe(true)

    const listed = await mcp('list_suggestions', { document: path })
    expect(listed.data.suggestions.map((s: any) => [s.type, s.tracked, s.suggestedText || s.originalText, s.by])).toEqual([
      ['insertion', true, ' (new)', 'Codex laptop'],
      ['deletion', true, 'zeta', 'Codex laptop'],
    ])
    // The agent's read is the original: the file's text.
    const reread = await mcp('read_document', { document: path })
    expect(reread.data.markdown).toBe(DOC)

    // No decision over MCP: accept and reject aren't on the list (#607).
    for (const name of ['accept_diff', 'reject_diff']) {
      expect(await mcp(name, { id: inserted.data.suggestionId })).toMatchObject({ success: false, code: 'UNKNOWN_TOOL' })
    }

    // The writer accepts the insertion and rejects the deletion, in the document.
    const selected = await executeProseTool(page, 'select_tab', { match: 'mcp.md' })
    expect(selected.success, JSON.stringify(selected)).toBe(true)
    await expect.poll(docText).toContain('epsilon (new)')
    await page.evaluate((id) => (window as any).__prose_editor.commands.acceptTrackedChange(id), inserted.data.suggestionId)
    await page.evaluate((id) => (window as any).__prose_editor.commands.rejectTrackedChange(id), deleted.data.suggestionId)
    const events = await mcp('list_review_events', { document: path, since: 0 })
    expect(events.data.events.map((e: any) => [e.kind, e.by])).toEqual([
      ['suggestion:proposed', 'Codex laptop'],
      ['suggestion:proposed', 'Codex laptop'],
      ['suggestion:accepted', 'the writer'],
      ['suggestion:rejected', 'the writer'],
    ])
    expect(await docText()).toBe('Alpha beta gamma.Delta epsilon (new) zeta.')
  })
})
