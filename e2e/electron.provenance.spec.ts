/**
 * Review provenance (#1232, P1 of #1230; design: docs/architecture/review-provenance.md).
 *
 * Every comment, reply, suggestion and AI annotation names who made it: the
 * writer (by their Settings name), a share reviewer, a Prose Agent (provider
 * and model) or an MCP agent (its connection). Records from before 1.9.1 have
 * no actor and are read, never rewritten: case 1 seeds 1.9.0-shaped rows
 * straight into IndexedDB and checks the names Activity shows. Case 2 makes
 * new records through the UI default, the in-app tool pipeline and the MCP
 * bridge, relaunches, and checks the stored actors, the names shown, what
 * `list_comments` tells an agent, and that the writer's email is in none of it.
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
} from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */

const NAME = 'Avery Writer'
const EMAIL = 'avery.p1232@example.test'

let app: ElectronApplication
let page: Page
let userDataDir: string
let docsDir: string

test.describe('review provenance', () => {
  test.beforeEach(async () => {
    test.setTimeout(120_000)
    userDataDir = mkdtempSync(join(tmpdir(), 'prose-1232-'))
    docsDir = mkdtempSync(join(tmpdir(), 'prose-1232-docs-'))
    seedSettings(userDataDir, { defaultSaveDirectory: docsDir, user: { name: NAME, email: EMAIL } })
    await launch()
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(docsDir, { recursive: true, force: true })
  })

  async function launch(): Promise<void> {
    const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9232' } })
    app = launched.app
    page = launched.page
    await waitForAppReady(page)
    await dismissOnboarding(page).catch(() => {})
    await dismissOverlay(page).catch(() => {})
  }

  interface TabInfo { tabId: string; title: string; path: string | null; documentId: string }

  async function openDoc(name: string, content: string, firstLine: string): Promise<TabInfo> {
    const path = join(docsDir, name)
    writeFileSync(path, content)
    const opened = await executeProseTool(page, 'open_file', { path })
    expect(opened.success, `open_file ${name}: ${JSON.stringify(opened)}`).toBe(true)
    await waitForEditor(page)
    await expect.poll(() => page.evaluate(() => (window as any).__prose_editor.state.doc.textContent as string)).toContain(firstLine)
    const listed = await executeProseTool(page, 'list_tabs', {})
    const tab = (listed.data as { tabs: TabInfo[] }).tabs.find((t) => t.title === name.replace(/\.md$/, ''))
    expect(tab, `tab ${name}`).toBeTruthy()
    return tab!
  }

  /** The document id Prose derives from a path (`generateIdFromPath`: the first 36 hex chars of its SHA-256). */
  const idForPath = (path: string) =>
    page.evaluate(async (p) => {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p))
      return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('').substring(0, 36)
    }, path)

  /** Write rows the way 1.9.0 stored them, straight into IndexedDB (no session writer involved). */
  const seedRows = (store: 'comments' | 'annotations', documentId: string, rows: unknown[]) =>
    page.evaluate(
      ({ store, documentId, rows }) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('prose-db')
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const tx = open.result.transaction(store, 'readwrite')
            tx.objectStore(store).put(rows, documentId)
            tx.oncomplete = () => { open.result.close(); resolve() }
            tx.onerror = () => reject(tx.error)
          }
        }),
      { store, documentId, rows },
    )

  const readRows = (kind: 'comments' | 'annotations', documentId: string) =>
    page.evaluate(
      ({ kind, documentId }) => {
        const tools = (window as any).__prose_tools
        return (kind === 'comments' ? tools.loadCommentsFromDB : tools.loadAnnotationsFromDB)(documentId) as Promise<any[]>
      },
      { kind, documentId },
    )

  /** Position range of `needle` in the active document. */
  async function rangeOf(needle: string): Promise<{ from: number; to: number }> {
    const from = await page.evaluate((needle) => {
      const editor = (window as any).__prose_editor
      let found = -1
      editor.state.doc.descendants((node: any, pos: number) => {
        if (found === -1 && node.isTextblock && node.textContent.includes(needle)) found = pos + 1 + node.textContent.indexOf(needle)
        return found === -1
      })
      return found
    }, needle)
    expect(from, `text "${needle}"`).toBeGreaterThan(-1)
    return { from, to: from + needle.length }
  }

  async function openActivity(): Promise<void> {
    const chatTab = page.getByRole('tab', { name: 'Chat' })
    if (!(await chatTab.isVisible({ timeout: 1_000 }).catch(() => false))) {
      await page.keyboard.press('ControlOrMeta+Shift+L')
      await chatTab.waitFor({ state: 'visible', timeout: 5_000 })
    }
    await page.getByRole('tab', { name: /Activity/ }).click()
  }

  /** Expand every comment row in Activity and return the names it shows (comments and replies). */
  async function activityCommentNames(): Promise<string[]> {
    const rows = page.getByTestId('comment-activity-row')
    await expect(rows.first()).toBeVisible()
    for (let i = 0; i < (await rows.count()); i++) await rows.nth(i).click()
    return page.getByTestId('activity-actor').allTextContents()
  }

  test('case 1: records written before 1.9.1 read with the right names', async () => {
    const probe = await openDoc('probe.md', 'Probe line.\n', 'Probe line.')
    expect(await idForPath(probe.path!), 'the spec derives document ids the way Prose does').toBe(probe.documentId)
    const legacyPath = probe.path!.replace(/probe\.md$/, 'legacy.md')
    const legacyId = await idForPath(legacyPath)
    const now = Date.now() - 60_000

    await seedRows('comments', legacyId, [
      { id: 'c-writer', markedText: 'Writer note', comment: 'From me', createdAt: now, author: 'user', occurrenceIndex: 0, from: 0, to: 0,
        replies: [{ id: 'r-dana', author: 'user', authorName: 'Dana', text: 'A reviewer reply', createdAt: now + 1 }], resolved: false },
      { id: 'c-ai', markedText: 'Agent note', comment: 'From an AI', createdAt: now, author: 'ai', occurrenceIndex: 0, from: 0, to: 0, replies: [], resolved: false },
      { id: 'c-rev', markedText: 'Reviewer note', comment: 'From a reviewer', createdAt: now, author: 'user', authorName: 'Dana', occurrenceIndex: 0, from: 0, to: 0, replies: [], resolved: false },
    ])
    const ann = (id: string, text: string, model: string) => ({
      id, documentId: legacyId, type: 'insertion', createdAt: now, from: 1, to: 1 + text.length, content: text, anchorText: text,
      provenance: { model, conversationId: 'conv', messageId: 'msg' },
    })
    await seedRows('annotations', legacyId, [
      ann('a-sonnet', 'Sonnet wrote this sentence.', 'claude-sonnet-5-5'),
      ann('a-mcp', 'The MCP client wrote this one.', 'Claude (MCP)'),
      ann('a-imported', 'Pasted text sits here.', 'Imported'),
    ])

    await openDoc(
      'legacy.md',
      'Writer note here. Agent note here. Reviewer note here.\n\nSonnet wrote this sentence.\n\nThe MCP client wrote this one.\n\nPasted text sits here.\n',
      'Writer note here.',
    )
    await openActivity()

    await expect.poll(() => page.getByTestId('annotation-actor').allTextContents())
      .toEqual(expect.arrayContaining(['Prose · Sonnet 5.5', 'MCP client', 'Imported']))
    const names = await activityCommentNames()
    expect(names).toEqual(expect.arrayContaining([NAME, 'Dana', 'AI']))
    // A share reviewer was shown as "you" in an expanded Activity row before 1.9.1.
    expect(names).not.toContain('you')

    // Read, never rewritten: the stored rows still have no actor.
    const stored = await readRows('comments', legacyId)
    expect(stored.every((c) => c.actor === undefined && (c.replies ?? []).every((r: any) => r.actor === undefined))).toBe(true)
  })

  test('case 2: new records carry their actor across a relaunch, and the email never leaves', async () => {
    const tab = await openDoc(
      'fresh.md',
      'One two three.\n\nFour five six.\n\nSeven eight nine.\n\nTen eleven twelve.\n',
      'One two three.',
    )

    // The writer, through the same command the comment UI calls (no actor passed: the writer by default).
    const mine = await rangeOf('One two three')
    await page.evaluate((r) => {
      ;(window as any).__prose_editor.chain().setTextSelection(r).setComment({ id: 'c-mine', comment: 'Mine' }).run()
    }, mine)

    // A Prose Agent, through the tool pipeline with the provenance the in-app chat stamps.
    const agentRange = await rangeOf('Four five six')
    const agentProvenance = {
      model: 'claude-opus-5-5', conversationId: 'conv-1232', messageId: 'msg-1232', documentId: tab.documentId,
      actor: { kind: 'prose-agent', provider: 'anthropic', model: 'claude-opus-5-5' },
    }
    const added = await page.evaluate(
      ({ args, provenance }) => (window as any).__prose_tools.executeTool('add_comment', args, 'create', provenance),
      { args: { ...agentRange, comment: 'Agent says' }, provenance: agentProvenance },
    )
    expect(added.success, JSON.stringify(added)).toBe(true)

    // An MCP agent, through the bridge's IPC (main → renderer), as the socket and HTTP servers deliver it.
    const mcpRange = await rangeOf('Seven eight nine')
    await app.evaluate(({ BrowserWindow }, args) => {
      BrowserWindow.getAllWindows()[0].webContents.send('mcp:tool:invoke', 'mcp-1232', 'add_comment', args)
    }, { ...mcpRange, comment: 'MCP says' })
    await expect.poll(async () => (await readRows('comments', tab.documentId)).map((c) => c.id).length).toBe(3)

    // A reply through the comment popover's UI.
    await page.locator('span[data-comment-id="c-mine"]').first().click()
    const replyBox = page.getByPlaceholder('Reply to the thread…')
    await replyBox.fill('My reply')
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect(page.getByTestId('reply-actor')).toHaveText([NAME])
    await page.keyboard.press('Escape')

    // A Prose Agent suggestion, accepted: the annotation keeps who proposed the text.
    const read = await executeProseTool(page, 'read_document', {})
    const nodes = (read.data as { nodes: Array<{ id: string; content?: string }> }).nodes
    const tenId = nodes.find((n) => (n.content ?? '').includes('Ten eleven twelve'))!.id
    const suggested = await page.evaluate(
      ({ args, provenance }) => (window as any).__prose_tools.executeTool('suggest_edit', args, 'create', provenance),
      { args: { nodeId: tenId, content: 'Ten eleven twelve, rewritten.' }, provenance: agentProvenance },
    )
    expect(suggested.success, JSON.stringify(suggested)).toBe(true)
    const accepted = await executeProseTool(page, 'accept_diff', { id: (suggested.data as { suggestionId: string }).suggestionId })
    expect(accepted.success, JSON.stringify(accepted)).toBe(true)

    // What an agent is told: names, never the writer's name or email.
    const listed = await executeProseTool(page, 'list_comments', {})
    expect(listed.success).toBe(true)
    const comments = (listed.data as { comments: Array<{ id: string; by: string; byKind: string; replies: Array<{ by: string }> }> }).comments
    const byId = Object.fromEntries(comments.map((c) => [c.id, c]))
    expect(byId['c-mine'].by).toBe('the writer')
    expect(byId['c-mine'].byKind).toBe('human')
    expect(byId['c-mine'].replies.map((r) => r.by)).toEqual(['the writer'])
    expect(comments.find((c) => c.by === 'Prose · Opus 5.5')?.byKind).toBe('prose-agent')
    expect(comments.find((c) => c.by === 'MCP client')?.byKind).toBe('mcp-agent')
    expect(JSON.stringify(listed)).not.toContain(EMAIL)
    expect(JSON.stringify(listed)).not.toContain(NAME)

    // Relaunch: the stored rows carry the actors, and nothing stored holds the email.
    // The tab-session draft saves on a 1 s debounce; let it settle first.
    await page.waitForTimeout(1_600)
    await app.close()
    await launch()
    await waitForEditor(page)
    await expect.poll(() => page.evaluate(() => (window as any).__prose_editor.state.doc.textContent as string)).toContain('One two three.')

    const rows = await readRows('comments', tab.documentId)
    const row = (id: string) => rows.find((c) => c.id === id)
    expect(row('c-mine')?.actor).toEqual({ kind: 'human', self: true })
    expect(row('c-mine')?.replies?.[0]?.actor).toEqual({ kind: 'human', self: true })
    expect(rows.find((c) => c.comment === 'Agent says')?.actor).toEqual(agentProvenance.actor)
    expect(rows.find((c) => c.comment === 'MCP says')?.actor).toMatchObject({ kind: 'mcp-agent', connectionId: 'launch', connectionLabel: 'MCP client' })
    const annotations = await readRows('annotations', tab.documentId)
    expect(annotations.length).toBeGreaterThan(0)
    expect(annotations.every((a) => a.provenance?.actor?.kind === 'prose-agent')).toBe(true)
    for (const stored of [rows, annotations]) expect(JSON.stringify(stored)).not.toContain(EMAIL)

    await openActivity()
    await expect.poll(() => page.getByTestId('annotation-actor').allTextContents()).toContain('Prose · Opus 5.5')
    expect(await activityCommentNames()).toEqual(expect.arrayContaining([NAME, 'Prose · Opus 5.5', 'MCP client']))
  })
})
