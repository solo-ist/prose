/**
 * The review log (#1233, P2 of #1230; design: review-provenance.md §5).
 *
 * A suggestion's whole life is kept after its mark goes: who proposed it, the
 * feedback on it, the revision that superseded it, who accepted the revision.
 * The events carry a per-document sequence an MCP agent can poll. All of it
 * survives a relaunch, read back from IndexedDB and from the document's state.
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

const AGENT = { kind: 'prose-agent', provider: 'anthropic', model: 'claude-opus-5-5' }
const MCP = { kind: 'mcp-agent', connectionId: 'c-1233', connectionLabel: 'Codex laptop' }

test.describe('review log', () => {
  test.beforeEach(async () => {
    test.setTimeout(120_000)
    userDataDir = mkdtempSync(join(tmpdir(), 'prose-1233-'))
    docsDir = mkdtempSync(join(tmpdir(), 'prose-1233-docs-'))
    seedSettings(userDataDir, { defaultSaveDirectory: docsDir })
    await launch()
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(docsDir, { recursive: true, force: true })
  })

  async function launch(): Promise<void> {
    const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9234' } })
    app = launched.app
    page = launched.page
    await waitForAppReady(page)
    await dismissOnboarding(page).catch(() => {})
    await dismissOverlay(page).catch(() => {})
  }

  const docText = () => page.evaluate(() => (window as any).__prose_editor.state.doc.textContent as string)
  const reviewLog = () => page.evaluate(() => (window as any).__prose_tools.getReviewLog())
  const storedLog = (documentId: string) => page.evaluate((id) => (window as any).__prose_tools.loadReviewLogFromDB(id), documentId)

  test('a suggestion’s life survives its mark and a relaunch', async () => {
    const path = join(docsDir, 'life.md')
    writeFileSync(path, 'The first sentence stays.\n\nThis sentence needs work.\n')
    const opened = await executeProseTool(page, 'open_file', { path })
    expect(opened.success, JSON.stringify(opened)).toBe(true)
    await waitForEditor(page)
    await expect.poll(docText).toContain('This sentence needs work.')
    const tabs = (await executeProseTool(page, 'list_tabs', {})).data as { tabs: Array<{ title: string; documentId: string }> }
    const documentId = tabs.tabs.find((t) => t.title === 'life')!.documentId

    // A Prose Agent proposes, through the tool pipeline with the chat's provenance.
    const read = await executeProseTool(page, 'read_document', {})
    const nodeId = (read.data as { nodes: Array<{ id: string; content?: string }> }).nodes.find((n) => (n.content ?? '').includes('needs work'))!.id
    const provenance = { model: 'claude-opus-5-5', conversationId: 'conv-1233', messageId: 'msg-1233', documentId, actor: AGENT }
    const suggested = await page.evaluate(
      ({ nodeId, provenance }) => (window as any).__prose_tools.executeTool('suggest_edit', { nodeId, content: 'This sentence works now.' }, 'create', provenance),
      { nodeId, provenance },
    )
    expect(suggested.success, JSON.stringify(suggested)).toBe(true)
    const firstId = suggested.data.suggestionId as string

    // The writer gives feedback (the popover's command); an MCP agent revises.
    await page.evaluate((id) => (window as any).__prose_editor.commands.setAISuggestionReply(id, 'Keep the word "sentence".'), firstId)
    await page.evaluate(
      ({ id, by }) => (window as any).__prose_editor.commands.reviseAISuggestion(id, { suggestedText: 'This sentence works now, kept.', by, newId: 'rev-1233' }),
      { id: firstId, by: MCP },
    )

    // The Prose Agent accepts the revision through accept_diff.
    const accepted = await page.evaluate(
      (provenance) => (window as any).__prose_tools.executeTool('accept_diff', { id: 'rev-1233' }, 'create', provenance),
      provenance,
    )
    expect(accepted.success, JSON.stringify(accepted)).toBe(true)
    await expect.poll(docText).toContain('This sentence works now, kept.')

    const expectLog = (log: any) => {
      const row = (id: string) => log.suggestions.find((s: any) => s.id === id)
      expect(row(firstId)).toMatchObject({ status: 'superseded', supersededBy: 'rev-1233', actor: AGENT, decidedBy: MCP })
      expect(row(firstId).feedback.map((f: any) => [f.text, f.actor])).toEqual([['Keep the word "sentence".', { kind: 'human', self: true }]])
      expect(row('rev-1233')).toMatchObject({ status: 'accepted', supersedes: firstId, actor: MCP, decidedBy: AGENT })
      expect(log.events.map((e: any) => e.kind)).toEqual([
        'suggestion:proposed',
        'suggestion:feedback',
        'suggestion:revised',
        'suggestion:accepted',
      ])
      expect(log.events.map((e: any) => e.seq)).toEqual([1, 2, 3, 4])
    }
    expectLog(await reviewLog())
    await expect.poll(async () => (await storedLog(documentId))?.events?.length ?? 0).toBe(4)
    expectLog(await storedLog(documentId))

    // Relaunch: the log reads back from IndexedDB into the document's state.
    await page.waitForTimeout(1_600)
    await app.close()
    await launch()
    await waitForEditor(page)
    await expect.poll(docText).toContain('This sentence works now, kept.')
    expectLog(await reviewLog())
    expect(await page.evaluate(() => new Promise<{ version: number; stores: string[] }>((resolve) => {
      const open = indexedDB.open('prose-db')
      open.onsuccess = () => {
        resolve({ version: open.result.version, stores: Array.from(open.result.objectStoreNames) })
        open.result.close()
      }
    }))).toMatchObject({ version: 10, stores: expect.arrayContaining(['review_log']) })
  })
})
