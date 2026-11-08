/**
 * MCP review tools (#890, M4 of #1230): PR #854's collaborative review over
 * the review log (#1233). An MCP agent proposes, reads the writer's feedback,
 * answers it, revises, and follows the writer's decisions through the event
 * cursor; it never accepts or rejects (#607). Calls arrive the way the bridge
 * delivers them: `mcp:tool:invoke` from main, results read off `mcp:tool:result`.
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

let app: ElectronApplication
let page: Page
let userDataDir: string
let docsDir: string
let callSeq = 0

interface McpResult { success: boolean; data?: any; error?: string; code?: string }

test.describe('MCP review tools', () => {
  test.beforeEach(async () => {
    test.setTimeout(120_000)
    userDataDir = mkdtempSync(join(tmpdir(), 'prose-890-'))
    docsDir = mkdtempSync(join(tmpdir(), 'prose-890-docs-'))
    seedSettings(userDataDir, { defaultSaveDirectory: docsDir })
    const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9235' } })
    app = launched.app
    page = launched.page
    await waitForAppReady(page)
    await dismissOnboarding(page).catch(() => {})
    await dismissOverlay(page).catch(() => {})
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as any
      g.__mcpResults = new Map()
      ipcMain.on('mcp:tool:result', (_event: unknown, id: string, result: unknown) => g.__mcpResults.set(id, result))
    })
    const path = join(docsDir, 'review.md')
    writeFileSync(path, 'Alpha one.\n\nBravo two.\n\nCharlie three.\n')
    const opened = await executeProseTool(page, 'open_file', { path })
    expect(opened.success, JSON.stringify(opened)).toBe(true)
    await waitForEditor(page)
    await expect.poll(docText).toContain('Charlie three.')
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(docsDir, { recursive: true, force: true })
  })

  const docText = () => page.evaluate(() => (window as any).__prose_editor.state.doc.textContent as string)

  async function mcp(name: string, args: Record<string, unknown> = {}): Promise<McpResult> {
    const id = `mcp-890-${++callSeq}`
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

  async function ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const result = await mcp(name, args)
    expect(result.success, `${name}: ${JSON.stringify(result)}`).toBe(true)
    return result.data
  }

  async function nodeIdOf(text: string): Promise<string> {
    const read = await ok('read_document')
    return (read.nodes as Array<{ id: string; content?: string }>).find((n) => (n.content ?? '').includes(text))!.id
  }

  const writer = (fn: string, ...args: unknown[]) =>
    page.evaluate(({ fn, args }) => (window as any).__prose_editor.commands[fn](...args), { fn, args })

  test('propose, feedback both ways, revise, the writer accepts, the agent follows the events', async () => {
    const proposed = await ok('suggest_edit', { nodeId: await nodeIdOf('Bravo two.'), content: 'Bravo, improved.' })
    const first = proposed.suggestionId as string

    await writer('setAISuggestionReply', first, 'Keep the number.')
    let listed = await ok('list_suggestions')
    expect(listed.suggestions).toEqual([
      expect.objectContaining({ id: first, status: 'pending', by: 'MCP client', byKind: 'mcp-agent', feedback: [expect.objectContaining({ text: 'Keep the number.', by: 'the writer', byKind: 'human' })] }),
    ])

    await ok('reply_to_suggestion', { id: first, text: 'Will do.' })
    listed = await ok('list_suggestions')
    expect(listed.suggestions[0].feedback.map((f: any) => [f.text, f.by])).toEqual([['Keep the number.', 'the writer'], ['Will do.', 'MCP client']])
    // The agent's answer is logged, not written over the writer's feedback the in-app chat reads.
    expect(await page.evaluate((id) => {
      let reply: string | null = null
      ;(window as any).__prose_editor.state.doc.descendants((node: any) => {
        for (const m of node.marks) if (m.type.name === 'aiSuggestion' && m.attrs.id === id) reply = m.attrs.userReply
      })
      return reply
    }, first)).toBe('Keep the number.')

    const revised = await ok('revise_suggestion', { id: first, content: 'Bravo two, improved.' })
    expect(revised.revises).toBe(first)
    const second = revised.suggestionId as string

    await writer('acceptAISuggestion', second)
    await expect.poll(docText).toContain('Bravo two, improved.')

    const events = await ok('list_review_events', { since: 0 })
    expect(events.events.map((e: any) => [e.kind, e.by])).toEqual([
      ['suggestion:proposed', 'MCP client'],
      ['suggestion:feedback', 'the writer'],
      ['suggestion:feedback', 'MCP client'],
      ['suggestion:revised', 'MCP client'],
      ['suggestion:accepted', 'the writer'],
    ])
    const last = events.events.at(-1).seq
    expect(await ok('list_review_events', { since: last })).toMatchObject({ events: [], more: false, nextSeq: last + 1 })

    expect(await ok('get_review_status')).toMatchObject({ pending: [], accepted: 1, rejected: 0, superseded: 1, lastSeq: last })
    const all = await ok('list_suggestions', { include: 'all' })
    expect(all.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first, status: 'superseded', supersededBy: second }),
      expect.objectContaining({ id: second, status: 'accepted', revises: first, decidedBy: 'the writer' }),
    ]))
  })

  test('comments: the agent replies to and reopens a thread the writer resolved', async () => {
    const added = await ok('add_comment', { nodeId: await nodeIdOf('Charlie three.'), comment: 'Is "three" right?' })
    await writer('resolveThread', added.id)
    await ok('reply_to_comment', { id: added.id, text: 'It changed upstream; reopening.' })
    await ok('reopen_comment', { id: added.id })
    const events = await ok('list_review_events')
    expect(events.events.map((e: any) => [e.kind, e.by])).toEqual([
      ['comment:added', 'MCP client'],
      ['comment:resolved', 'the writer'],
      ['comment:replied', 'MCP client'],
      ['comment:reopened', 'MCP client'],
    ])
    expect((await mcp('reopen_comment', { id: added.id })).code).toBe('COMMENT_OPEN')
  })

  test('a second suggestion on a node supersedes the first; the agent can never decide', async () => {
    const alpha = await nodeIdOf('Alpha one.')
    const a1 = (await ok('suggest_edit', { nodeId: alpha, content: 'Alpha, first try.' })).suggestionId
    const again = await ok('suggest_edit', { nodeId: alpha, content: 'Alpha one, second try.' })
    expect(again.revises).toBe(a1)
    const all = await ok('list_suggestions', { include: 'all' })
    expect(all.suggestions.find((s: any) => s.id === a1)).toMatchObject({ status: 'superseded', supersededBy: again.suggestionId })

    for (const tool of ['accept_diff', 'reject_diff']) {
      const refused = await mcp(tool, { id: again.suggestionId })
      expect(refused.success).toBe(false)
      expect(refused.code).toBe('UNKNOWN_TOOL')
    }
    expect((await ok('get_review_status')).pending).toEqual([again.suggestionId])
  })
})
