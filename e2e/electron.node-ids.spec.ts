/**
 * Node ID uniqueness (#681) — regression coverage for duplicate nodeIds
 * created by node splits.
 *
 * ProseMirror copies a node's attributes (including `nodeId`) to BOTH halves
 * when a block is split (Enter mid-paragraph, or an insert that produces a
 * sibling). The nodeIds extension's appendTransaction only assigned ids to
 * id-LESS nodes, so both halves kept the same id forever — which broke
 * id-based targeting (read_document emitted two nodes with one id;
 * suggest_edit resolved to the wrong occurrence and tripped the
 * destructive-edit guard).
 *
 * Drives the editor directly (window.__prose_editor) + the real read_document
 * tool (window.__prose_tools) in an isolated PROSE_USER_DATA_DIR profile.
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
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string

test.beforeAll(async () => {
  test.setTimeout(60_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-profile-'))
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)

  const newDocButton = page.getByRole('button', { name: 'New Document' })
  if (await newDocButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await newDocButton.click({ force: true })
  }
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
})

/** Collect every block nodeId in the document (in order). */
async function blockNodeIds(testPage: Page): Promise<string[]> {
  return testPage.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    const ids: string[] = []
    editor.state.doc.descendants((node: { attrs: Record<string, unknown> }) => {
      const id = node.attrs.nodeId
      if (typeof id === 'string' && id) ids.push(id)
    })
    return ids
  })
}

test.describe('Electron — node ID uniqueness (#681)', () => {
  test('splitting a paragraph yields distinct nodeIds for both halves', async () => {
    // One paragraph; the extension assigns it an id on load.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      editor.commands.setContent('<p>First half and second half live here together.</p>')
    })

    const before = await blockNodeIds(page)
    expect(before).toHaveLength(1)

    // Split it mid-text (the Enter-key path) — ProseMirror copies nodeId to both halves.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      // Place the cursor after "First half " (position ~12 in content coords)
      editor.commands.setTextSelection(12)
      editor.commands.splitBlock()
    })

    const after = await blockNodeIds(page)
    expect(after.length).toBeGreaterThanOrEqual(2)
    // The two halves must have DISTINCT ids (the bug left them equal).
    expect(new Set(after).size).toBe(after.length)
  })

  test('read_document never emits duplicate nodeIds after repeated splits', async () => {
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      editor.commands.setContent('<p>Alpha beta gamma delta epsilon zeta eta theta.</p>')
    })

    // Split several times at different offsets.
    for (const offset of [30, 18, 6]) {
      await page.evaluate((pos) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = (window as any).__prose_editor
        editor.commands.setTextSelection(pos)
        editor.commands.splitBlock()
      }, offset)
    }

    // Live doc: all ids unique.
    const ids = await blockNodeIds(page)
    expect(ids.length).toBeGreaterThanOrEqual(4)
    expect(new Set(ids).size).toBe(ids.length)

    // read_document (the AI-facing surface): flatten the tree, assert unique.
    const read = await executeProseTool(page, 'read_document', {})
    expect(read.success).toBe(true)
    interface DocNode { id: string; children?: DocNode[] }
    const flatten = (nodes: DocNode[]): string[] =>
      nodes.flatMap((n) => [n.id, ...(n.children ? flatten(n.children) : [])]).filter(Boolean)
    const docIds = flatten((read.data as { nodes: DocNode[] }).nodes)
    expect(new Set(docIds).size).toBe(docIds.length)
  })

  test('suggest_edit targets the correct half after a split', async () => {
    // Reproduce the report: a long paragraph, then a short sibling created by
    // a split. Targeting the short one by id must NOT resolve to the long one.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      editor.commands.setContent(
        '<p>This is a deliberately long load-bearing paragraph that comfortably exceeds two hundred characters so that the destructive-edit guard would fire if a short replacement were mistakenly routed to it instead of the short sibling node below.</p>',
      )
      // Cursor at the very end, split to create an empty sibling, type the short text.
      editor.commands.setTextSelection(editor.state.doc.content.size)
      editor.commands.splitBlock()
      editor.commands.insertContent('This should be a heading')
    })

    const read = await executeProseTool(page, 'read_document', {})
    expect(read.success).toBe(true)
    const nodes = (read.data as { nodes: Array<{ id: string; content: string }> }).nodes
    const shortNode = nodes.find((n) => n.content === 'This should be a heading')
    expect(shortNode, 'short sibling present in read_document').toBeTruthy()

    // Block-convert the short node to a heading — must succeed (it resolved to
    // the short node, not the >200-char paragraph, so no destructive guard).
    const suggested = await executeProseTool(page, 'suggest_edit', {
      nodeId: shortNode!.id,
      content: '## This should be a heading',
    })
    expect(suggested.success, `suggest_edit failed: ${suggested.code} ${suggested.error}`).toBe(true)
  })
})
