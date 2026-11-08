/**
 * Activity over the review log (#1234, P4 of #1230).
 *
 * Suggestions show in Activity with their whole life: who proposed each one,
 * the feedback, the revision that replaced it, and who decided it. The actor
 * filter narrows the feed to one person or agent, and the badge follows. A
 * pending suggestion opens Quick Review on itself.
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
const MCP = { kind: 'mcp-agent', connectionId: 'c-1234', connectionLabel: 'Codex laptop' }

test.describe('Activity review', () => {
  test.beforeEach(async () => {
    test.setTimeout(120_000)
    userDataDir = mkdtempSync(join(tmpdir(), 'prose-1234-'))
    docsDir = mkdtempSync(join(tmpdir(), 'prose-1234-docs-'))
    seedSettings(userDataDir, { defaultSaveDirectory: docsDir })
    const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9236' } })
    app = launched.app
    page = launched.page
    await waitForAppReady(page)
    await dismissOnboarding(page).catch(() => {})
    await dismissOverlay(page).catch(() => {})
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(docsDir, { recursive: true, force: true })
  })

  const docText = () => page.evaluate(() => (window as any).__prose_editor.state.doc.textContent as string)
  const commands = (fn: string, ...args: unknown[]) =>
    page.evaluate(({ fn, args }) => (window as any).__prose_editor.commands[fn](...args), { fn, args })

  async function agentSuggests(text: string, content: string): Promise<string> {
    const read = await executeProseTool(page, 'read_document', {})
    const nodeId = (read.data as { nodes: Array<{ id: string; content?: string }> }).nodes.find((n) => (n.content ?? '').includes(text))!.id
    const result = await page.evaluate(
      ({ nodeId, content, actor }) =>
        (window as any).__prose_tools.executeTool('suggest_edit', { nodeId, content }, 'create', {
          model: 'claude-opus-5-5', conversationId: 'conv-1234', messageId: 'msg-1234', documentId: '', actor,
        }),
      { nodeId, content, actor: AGENT },
    )
    expect(result.success, JSON.stringify(result)).toBe(true)
    return result.data.suggestionId
  }

  async function openActivity(): Promise<void> {
    const chatTab = page.getByRole('tab', { name: 'Chat' })
    if (!(await chatTab.isVisible({ timeout: 1_000 }).catch(() => false))) {
      await page.keyboard.press('ControlOrMeta+Shift+L')
      await chatTab.waitFor({ state: 'visible', timeout: 5_000 })
    }
    await page.getByRole('tab', { name: /Activity/ }).click()
  }

  const row = (id: string) => page.locator(`[data-testid="suggestion-activity-row"][data-suggestion-id="${id}"]`)

  test('suggestions show their life in Activity; the actor filter narrows it; a pending one opens Quick Review', async () => {
    const path = join(docsDir, 'activity.md')
    writeFileSync(path, 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.\n')
    expect((await executeProseTool(page, 'open_file', { path })).success).toBe(true)
    await waitForEditor(page)
    await expect.poll(docText).toContain('Third paragraph here.')

    const first = await agentSuggests('Second paragraph', 'Second paragraph, sharper.')
    await commands('setAISuggestionReply', first, 'Keep it short.')
    await commands('reviseAISuggestion', first, { suggestedText: 'Second, sharper.', by: MCP, newId: 'rev-1234' })
    await commands('acceptAISuggestion', 'rev-1234')
    await expect.poll(docText).toContain('Second, sharper.')
    const third = await agentSuggests('Third paragraph', 'Third paragraph, pending.')
    await agentSuggests('First paragraph', 'First paragraph, pending.')

    await openActivity()
    await expect(row(first)).toHaveAttribute('data-status', 'superseded')
    await expect(row(first).getByTestId('suggestion-row-actor')).toHaveText('Prose · Opus 5.5')
    await expect(row(first).getByTestId('suggestion-decided-by')).toHaveText('Revised by Codex laptop')
    await expect(row('rev-1234')).toHaveAttribute('data-status', 'accepted')
    await expect(row('rev-1234').getByTestId('suggestion-row-actor')).toHaveText('Codex laptop')
    await expect(row('rev-1234').getByTestId('suggestion-decided-by')).toHaveText('Accepted by You')
    await expect(row(third)).toHaveAttribute('data-status', 'pending')
    await row(first).click()
    await expect(row(first).getByTestId('suggestion-feedback')).toContainText('Keep it short.')

    // Everything: 4 suggestions + 1 accepted edit's annotation.
    const badge = page.getByTestId('activity-count-badge')
    await expect(badge).toHaveText('5')

    // Narrow to the MCP connection: the suggestion it revised (it decided that one),
    // the revision it proposed, and the edit that came from it.
    await page.click('[aria-label="Filter activity"]')
    await page.waitForSelector('[role="menu"]')
    await page.getByRole('menuitem', { name: 'Codex laptop' }).click()
    await expect(badge).toHaveText('3')
    await expect(row(third)).toHaveCount(0)
    await expect(row(first)).toHaveCount(1)
    await expect(row('rev-1234')).toHaveCount(1)
    await page.getByRole('menuitem', { name: 'Show all' }).click()
    await expect(badge).toHaveText('5')

    // A pending suggestion opens Quick Review on itself: the third paragraph's is
    // second of the two pending, in document order.
    await row(third).click()
    await expect(page.getByRole('heading', { name: 'Quick Review' })).toBeVisible()
    await expect(page.getByText('2/2', { exact: true })).toBeVisible()
  })

  test('a suggestion the writer rejected and an agent revised stays Rejected and names the revision (#1266)', async () => {
    const path = join(docsDir, 'rejected.md')
    writeFileSync(path, 'First paragraph here.\n\nSecond paragraph here.\n')
    expect((await executeProseTool(page, 'open_file', { path })).success).toBe(true)
    await waitForEditor(page)
    await expect.poll(docText).toContain('Second paragraph here.')

    const first = await agentSuggests('Second paragraph', 'Second paragraph, sharper.')
    await commands('rejectAISuggestion', first)
    // The revision, as an MCP call makes it.
    const revised = await page.evaluate(
      ({ id, actor }) =>
        (window as any).__prose_tools.executeTool(
          'revise_suggestion',
          { id, content: 'Second paragraph, sharper still.' },
          'create',
          { model: '', conversationId: '', messageId: '', documentId: '', actor },
          undefined,
          { preserveView: true },
        ),
      { id: first, actor: MCP },
    )
    expect(revised.success, JSON.stringify(revised)).toBe(true)
    const second = revised.data.suggestionId as string

    await openActivity()
    await expect(row(first)).toHaveAttribute('data-status', 'rejected')
    await expect(row(first).getByTestId('suggestion-status')).toHaveText('Rejected')
    await expect(row(first).getByTestId('suggestion-decided-by')).toHaveText('Rejected by You')
    await expect(row(first).getByTestId('suggestion-revised-after')).toContainText('Then revised by Codex laptop')
    await expect(row(first)).not.toContainText(/superseded/i)
    await expect(row(second)).toHaveAttribute('data-status', 'pending')

    // The link opens Quick Review on the revision.
    await row(first).getByTestId('suggestion-open-revision').click()
    await expect(page.getByRole('heading', { name: 'Quick Review' })).toBeVisible()
    await expect(page.getByText('1/1', { exact: true })).toBeVisible()
  })
})
