/**
 * Activity panel redesign (#684) — covers the tab rename, the visible-count
 * badge, and the superseded filter wiring (lifted to ChatPanel's tab header).
 *
 * Seeds a real + a superseded annotation via the tool pipeline (accept an
 * edit, then accept an overlapping edit on the same node — the first
 * annotation's range collapses and detaches, #674), then drives the Activity
 * tab UI. Isolated PROSE_USER_DATA_DIR profile.
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
  getAnnotations,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

async function nodeIdByText(testPage: Page, text: string): Promise<string> {
  const read = await executeProseTool(testPage, 'read_document', {})
  expect(read.success).toBe(true)
  interface DocNode { id: string; content?: string; children?: DocNode[] }
  const flatten = (nodes: DocNode[]): DocNode[] =>
    nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
  const match = flatten((read.data as { nodes: DocNode[] }).nodes).find((n) =>
    (n.content ?? '').includes(text),
  )
  expect(match, `node containing "${text}"`).toBeTruthy()
  return match!.id
}

/** Poll out the ~100ms annotation mapping-pause window before an accept. */
async function waitForMappingResumed(testPage: Page): Promise<void> {
  await expect
    .poll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => testPage.evaluate(() => (window as any).__prose_tools.isAnnotationMappingPaused()),
      { timeout: 5_000 },
    )
    .toBe(false)
}

async function suggestAndAccept(testPage: Page, nodeId: string, content: string): Promise<void> {
  const suggested = await executeProseTool(testPage, 'suggest_edit', { nodeId, content })
  expect(suggested.success).toBe(true)
  await waitForMappingResumed(testPage)
  const accepted = await executeProseTool(testPage, 'accept_diff', {
    id: (suggested.data as { suggestionId: string }).suggestionId,
  })
  expect(accepted.success).toBe(true)
}

test.beforeAll(async () => {
  test.setTimeout(60_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-profile-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-qa-docs-'))
  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify({ appearance: { mode: 'dark', icon: 'default' }, defaultSaveDirectory: qaDocsDir }),
  )

  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)

  // Seed: one current annotation + one superseded.
  const created = await executeProseTool(page, 'create_and_open_file', {
    filename: 'activity.md',
    content: 'A paragraph to be edited and then re-edited.\n\nA second untouched paragraph.',
  })
  expect(created.success).toBe(true)
  await waitForEditor(page)

  const p1 = await nodeIdByText(page, 'A paragraph to be edited')
  await suggestAndAccept(page, p1, 'A paragraph after its first edit.') // annotation A
  const p1b = await nodeIdByText(page, 'A paragraph after its first edit.')
  await suggestAndAccept(page, p1b, 'A paragraph rewritten a second time.') // A detaches, B created

  const anns = await getAnnotations(page)
  expect(anns.length).toBe(2)
  expect(anns.filter((a) => a.detached === true)).toHaveLength(1)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

/** Ensure the chat panel is open (tabs are visible) without toggling it closed. */
async function ensureChatPanelOpen(testPage: Page): Promise<void> {
  const chatTab = testPage.getByRole('tab', { name: 'Chat' })
  const isOpen = await chatTab.isVisible({ timeout: 1_000 }).catch(() => false)
  if (!isOpen) {
    await testPage.keyboard.press('ControlOrMeta+Shift+L')
    await chatTab.waitFor({ state: 'visible', timeout: 5_000 })
  }
}

test.describe('Electron — Activity panel', () => {
  test('Activity tab + badge + superseded filter', async () => {
    // Ensure the chat panel is open (open it if not, don't toggle if already open).
    await ensureChatPanelOpen(page)
    const activityTab = page.getByRole('tab', { name: /Activity/ })
    await activityTab.waitFor({ state: 'visible', timeout: 5_000 })
    await activityTab.click()

    // Badge shows the total (2) while superseded are included.
    const badge = page.getByTestId('activity-count-badge')
    await expect(badge).toHaveText('2')

    // The superseded row + the filter funnel are present.
    await expect(page.getByTestId('annotation-detached-badge')).toBeVisible()
    const filterBtn = page.getByRole('button', { name: 'Hide superseded edits' })
    await expect(filterBtn).toBeVisible()

    // Engage the filter → superseded hidden, badge drops to current-only (1).
    await filterBtn.click()
    await expect(badge).toHaveText('1')
    await expect(page.getByTestId('annotation-detached-badge')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Show superseded edits' })).toBeVisible()

    // Toggle back → superseded reappears, badge back to 2.
    await page.getByRole('button', { name: 'Show superseded edits' }).click()
    await expect(badge).toHaveText('2')
    await expect(page.getByTestId('annotation-detached-badge')).toBeVisible()
  })

  test('arrow keys move focus + selection across the tablist (#719)', async () => {
    // Ensure the chat panel is open and the Chat tab is visible.
    await ensureChatPanelOpen(page)

    // Land on the Chat tab; roving tabindex puts focus on the active tab.
    const chatTab = page.getByRole('tab', { name: 'Chat' })
    const activityTab = page.getByRole('tab', { name: /Activity/ })
    await chatTab.click()
    // Use element-level focus via evaluate so the DOM focus event fires reliably
    // in headless Electron on Xvfb (where page.keyboard events go to the focused
    // element — bringToFront alone doesn't route keydowns to the tablist).
    await chatTab.evaluate((el: HTMLElement) => el.focus())
    await expect(chatTab).toHaveJSProperty('tabIndex', 0)
    await expect(activityTab).toHaveJSProperty('tabIndex', -1)

    // ArrowRight → select Activity. Send the keydown directly to chatTab so the
    // roving-tabindex keydown handler receives it regardless of window focus state.
    // Assert roving-tabindex state (aria-selected + tabIndex) — not OS focus, which
    // isn't reliable in headless CI.
    await chatTab.press('ArrowRight')
    await expect(activityTab).toHaveAttribute('aria-selected', 'true')
    await expect(activityTab).toHaveJSProperty('tabIndex', 0)
    await expect(chatTab).toHaveAttribute('aria-selected', 'false')
    await expect(chatTab).toHaveJSProperty('tabIndex', -1)

    // ArrowRight wraps back to Chat. Send to activityTab (now focused by roving tabindex).
    await activityTab.press('ArrowRight')
    await expect(chatTab).toHaveAttribute('aria-selected', 'true')
    await expect(chatTab).toHaveJSProperty('tabIndex', 0)
    await expect(activityTab).toHaveJSProperty('tabIndex', -1)

    // ArrowLeft wraps to the last tab (Activity). Send to chatTab (now focused).
    await chatTab.press('ArrowLeft')
    await expect(activityTab).toHaveAttribute('aria-selected', 'true')
    await expect(activityTab).toHaveJSProperty('tabIndex', 0)

    // Home returns to Chat. Send to activityTab (now focused).
    await activityTab.press('Home')
    await expect(chatTab).toHaveAttribute('aria-selected', 'true')
    await expect(chatTab).toHaveJSProperty('tabIndex', 0)

    // End moves to Activity. Send to chatTab (now focused).
    await chatTab.press('End')
    await expect(activityTab).toHaveAttribute('aria-selected', 'true')
    await expect(activityTab).toHaveJSProperty('tabIndex', 0)
  })

  test('chat actions stay visible on the Activity tab (#688)', async () => {
    // Ensure the panel is open independently — don't rely on prior test state.
    await ensureChatPanelOpen(page)
    // On the Activity tab, the chat action cluster must NOT disappear.
    const activityTab = page.getByRole('tab', { name: /Activity/ })
    await activityTab.waitFor({ state: 'visible', timeout: 5_000 })
    await activityTab.click()
    await expect(page.getByRole('button', { name: 'Document info' })).toBeVisible()
    const newChatBtn = page.getByRole('button', { name: 'New chat' })
    await expect(newChatBtn).toBeVisible()

    // Invoking New chat from Activity switches to the chat view (input appears).
    await newChatBtn.click()
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 5_000 })
  })
})
