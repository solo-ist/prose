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

test.describe('Electron — Activity panel', () => {
  test('Activity tab + badge + superseded filter', async () => {
    // Open the chat sidebar and switch to the Activity tab.
    await page.keyboard.press('ControlOrMeta+Shift+L')
    const activityTab = page.getByRole('button', { name: /Activity/ })
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

  test('chat actions stay visible on the Activity tab (#688)', async () => {
    // On the Activity tab, the chat action cluster must NOT disappear.
    await page.getByRole('button', { name: /Activity/ }).click()
    await expect(page.getByRole('button', { name: 'Document info' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible()

    // Invoking New chat from Activity switches to the chat view (input appears).
    await page.getByRole('button', { name: 'New chat' }).click()
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 5_000 })
  })
})
