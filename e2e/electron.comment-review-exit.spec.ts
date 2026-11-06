/**
 * "Back to activity" lands on the Activity tab (#1135).
 *
 * The done state's button promised the Activity view but only cleared the
 * review mode, so the sidebar showed whatever tab it was on before, usually
 * Chat. The button now selects Activity first; the close button and Escape
 * still return to the previous tab.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
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

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

const selectedTab = () => page.locator('[role="tab"][aria-selected="true"]')
// The status bar's open-thread count opens Comment Review; the chat chip offers the same text.
// Falls back to the bar's own shape so the spec also runs (and fails for the right
// reason) on a build without the test id.
const statusBarReview = () =>
  page.locator('[data-testid="status-bar"], div.h-6.border-t.border-border').first().getByRole('button', { name: /1 comment/ })

async function toggleChat(): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:action', 'toggleChat')
  })
}

async function commentOn(text: string): Promise<string> {
  const read = await executeProseTool(page, 'read_document', {})
  expect(read.success).toBe(true)
  interface DocNode { id: string; content?: string; children?: DocNode[] }
  const flatten = (nodes: DocNode[]): DocNode[] => nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
  const node = flatten((read.data as { nodes: DocNode[] }).nodes).find((n) => n.id && (n.content ?? '').includes(text))
  expect(node, `node containing "${text}"`).toBeTruthy()
  const added = await executeProseTool(page, 'add_comment', { nodeId: node!.id, comment: 'Needs a source.' }, 'editor')
  expect(added.success, JSON.stringify(added)).toBe(true)
  return (added.data as { id: string }).id
}

test.beforeAll(async () => {
  test.setTimeout(90_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1135-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-1135-docs-'))
  seedSettings(qaUserDataDir, { defaultSaveDirectory: qaDocsDir, aiConsent: { consented: false, version: 1 } })
  const result = await launchApp({
    env: { PROSE_USER_DATA_DIR: qaUserDataDir, PROSE_DOCS_DIR: qaDocsDir, PROSE_DEBUG_PORT: '9229' }
  })
  app = result.app
  page = result.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

test.describe('Electron — leaving Comment Review (#1135)', () => {
  test('"Back to activity" selects the Activity tab; the close button keeps the previous one', async () => {
    const created = await executeProseTool(page, 'create_and_open_file', {
      filename: 'review-exit.md',
      content: '# Review\n\nA claim that needs a source.\n\nAnother paragraph.'
    })
    expect(created.success).toBe(true)
    await waitForEditor(page)
    const threadId = await commentOn('A claim that needs a source.')

    // The sidebar opens on Chat.
    await toggleChat()
    await expect(selectedTab()).toHaveText(/Chat/)

    // Review from the status bar, resolve the only thread, land on the done state.
    await statusBarReview().click()
    await expect(page.getByText('Commenting on')).toBeVisible()
    const resolved = await executeProseTool(page, 'resolve_comment', { id: threadId }, 'editor')
    expect(resolved.success, JSON.stringify(resolved)).toBe(true)
    const back = page.getByRole('button', { name: 'Back to activity' })
    await expect(back).toBeVisible()

    await back.click()
    await expect(back).toHaveCount(0)
    await expect(selectedTab()).toHaveText(/Activity/)

    // The close button on the done state returns to whatever tab was showing.
    await page.locator('[role="tab"]', { hasText: 'Chat' }).click()
    await expect(selectedTab()).toHaveText(/Chat/)
    const id2 = await commentOn('Another paragraph.')
    await statusBarReview().click()
    const resolved2 = await executeProseTool(page, 'resolve_comment', { id: id2 }, 'editor')
    expect(resolved2.success).toBe(true)
    await expect(page.getByRole('button', { name: 'Back to activity' })).toBeVisible()
    await page.getByRole('button', { name: 'Close review' }).click()
    await expect(selectedTab()).toHaveText(/Chat/)
  })
})
