/**
 * AI-edit annotation lifecycle (#674) — regression coverage for the
 * TestFlight v1.6.1 report "accepted edits showed in the history panel, then
 * toggling around they disappeared, except two."
 *
 * Verified loss paths covered here:
 *   • accept-all created NO annotations at all
 *   • a later overlapping accept silently DELETED the earlier annotation
 *     (now: detach-don't-delete — history is an immutable per-document log)
 *   • annotations lost across tab switches (save race / double-load)
 *   • annotations orphaned by file rename (path-derived documentId)
 *   • persistence across app restart
 *
 * Drives the real tool pipeline through window.__prose_tools in an isolated
 * PROSE_USER_DATA_DIR profile.
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
  getAnnotationDocId,
  readAnnotationsFromDB,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

/** read_document → first top-level node id whose content contains `text`. */
async function nodeIdByText(testPage: Page, text: string): Promise<string> {
  const result = await executeProseTool(testPage, 'read_document', {})
  expect(result.success).toBe(true)
  interface DocNode { id: string; content?: string; children?: DocNode[] }
  const flatten = (nodes: DocNode[]): DocNode[] =>
    nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])
  const match = flatten((result.data as { nodes: DocNode[] }).nodes).find((n) =>
    (n.content ?? '').includes(text),
  )
  expect(match, `node containing "${text}"`).toBeTruthy()
  return match!.id
}

/**
 * The annotation store suppresses position mapping for ~100ms after tab and
 * document switches (setLoadingDocument). An edit dispatched inside that
 * window is excluded from mapping — its collapse/detach effects on existing
 * annotations never run. Poll the seam until the window closes so accepts
 * always get a real mapping pass (this is what made the detach assertion
 * CI-flaky: three fast IPC roundtrips can land inside the window).
 */
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
    JSON.stringify(
      {
        appearance: { mode: 'dark', icon: 'default' },
        defaultSaveDirectory: qaDocsDir,
        featureFlags: { aiPipelineDebug: true },
      },
      null,
      2,
    ),
  )

  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir } })
  app = launched.app
  page = launched.page

  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

test.describe('Electron — AI edit annotation lifecycle', () => {
  test('C1: single accepts create annotations (inline + block conversion)', async () => {
    const created = await executeProseTool(page, 'create_and_open_file', {
      filename: 'lifecycle.md',
      content: 'First paragraph here.\n\nSection title line.\n\nClosing paragraph stays.',
    })
    expect(created.success).toBe(true)
    await waitForEditor(page)

    // Inline-markdown accept
    const p1 = await nodeIdByText(page, 'First paragraph here.')
    await suggestAndAccept(page, p1, '**First** paragraph here.')

    // Block-conversion accept
    const p2 = await nodeIdByText(page, 'Section title line.')
    await suggestAndAccept(page, p2, '## Section title line.')

    const annotations = await getAnnotations(page)
    expect(annotations.length).toBeGreaterThanOrEqual(2)
    expect(annotations.every((a) => a.detached !== true)).toBe(true)
  })

  test('C2: accept-all creates annotations for every suggestion', async () => {
    const created = await executeProseTool(page, 'create_and_open_file', {
      filename: 'accept-all.md',
      content: 'Alpha line one.\n\nBeta line two.\n\nGamma line three.',
    })
    expect(created.success).toBe(true)
    await waitForEditor(page)

    for (const [text, replacement] of [
      ['Alpha line one.', 'Alpha line improved.'],
      ['Beta line two.', 'Beta line refined.'],
      ['Gamma line three.', '## Gamma heading three'],
    ] as const) {
      const nodeId = await nodeIdByText(page, text)
      const suggested = await executeProseTool(page, 'suggest_edit', { nodeId, content: replacement })
      expect(suggested.success).toBe(true)
    }

    // Batch accept — previously created ZERO annotations
    await waitForMappingResumed(page)
    const acceptAll = await executeProseTool(page, 'accept_diff', {})
    expect(acceptAll.success).toBe(true)

    const annotations = await getAnnotations(page)
    expect(annotations.length).toBeGreaterThanOrEqual(3)
  })

  test('C3a: annotations survive tab toggling', async () => {
    // Currently on accept-all.md (3+ annotations). Toggle to lifecycle.md and back.
    const before = await getAnnotations(page)
    const beforeCount = before.length
    const docIdBefore = await getAnnotationDocId(page)

    const toLifecycle = await executeProseTool(page, 'select_tab', { match: 'lifecycle' })
    expect(toLifecycle.success).toBe(true)
    // lifecycle.md has its own annotations from C1
    expect((await getAnnotations(page)).length).toBeGreaterThanOrEqual(2)

    const backAgain = await executeProseTool(page, 'select_tab', { match: 'accept-all' })
    expect(backAgain.success).toBe(true)

    expect(await getAnnotationDocId(page)).toBe(docIdBefore)
    expect((await getAnnotations(page)).length).toBe(beforeCount)
  })

  test('C3b: overlapping accept detaches the earlier annotation instead of deleting it', async () => {
    // On accept-all.md, the 'Alpha line improved.' node already has an
    // annotation. Accept ANOTHER suggestion on the same node — the earlier
    // annotation's range collapses under mapping and must detach, not vanish.
    const before = await getAnnotations(page)
    const beforeCount = before.length

    const alphaId = await nodeIdByText(page, 'Alpha line improved.')
    await suggestAndAccept(page, alphaId, 'Alpha sentence rewritten entirely.')

    const after = await getAnnotations(page)
    // Nothing vanished: the earlier annotation detached, the new accept added one or more
    expect(after.length).toBeGreaterThan(beforeCount)
    expect(after.some((a) => a.detached === true)).toBe(true)
    expect(after.some((a) => a.detached !== true)).toBe(true)
  })

  test('rename migrates annotations to the new path-derived documentId', async () => {
    // Switch to lifecycle.md and rename its tab
    const select = await executeProseTool(page, 'select_tab', { match: 'lifecycle' })
    expect(select.success, `select_tab failed: ${select.code} ${select.error}`).toBe(true)
    await waitForEditor(page)

    const docIdBefore = await getAnnotationDocId(page)
    const countBefore = (await getAnnotations(page)).length
    expect(countBefore).toBeGreaterThanOrEqual(2)

    // Rename the active tab via the test seam (window.__prose_renameTab),
    // exercising the same renameTab path the inline-rename UI calls — without
    // the fragile double-click → input → keyboard dance. The migration logic
    // (annotations re-keyed to the new path-derived documentId) is the point.
    const renamed = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any
      const tabId = w.__prose_tools.getActiveTabId()
      return w.__prose_renameTab(tabId, 'lifecycle-renamed')
    })
    expect(renamed, 'renameTab returned null (rename failed)').toBeTruthy()

    // The store's documentId must change (path-derived) and annotations survive
    await expect.poll(async () => getAnnotationDocId(page), { timeout: 5_000 }).not.toBe(docIdBefore)
    const docIdAfter = await getAnnotationDocId(page)
    expect(docIdAfter).toBeTruthy()
    expect((await getAnnotations(page)).length).toBe(countBefore)

    // And the migrated key holds them in IndexedDB
    const persisted = await readAnnotationsFromDB(page, docIdAfter!)
    expect(persisted.length).toBe(countBefore)
  })

  test('annotations survive app restart (including detached entries)', async () => {
    // Capture accept-all.md's state, then restart with the same profile
    const select = await executeProseTool(page, 'select_tab', { match: 'accept-all' })
    expect(select.success).toBe(true)
    const docId = await getAnnotationDocId(page)
    const liveCount = (await getAnnotations(page)).length
    const detachedCount = (await getAnnotations(page)).filter((a) => a.detached === true).length
    expect(docId).toBeTruthy()
    expect(liveCount).toBeGreaterThan(0)
    expect(detachedCount).toBeGreaterThan(0)

    await app.close()
    const relaunched = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir } })
    app = relaunched.app
    page = relaunched.page
    await waitForAppReady(page)
    await dismissOnboarding(page)
    await dismissOverlay(page)

    // Read straight from IndexedDB — the immutable log survives restart
    const persisted = await readAnnotationsFromDB(page, docId!)
    expect(persisted.length).toBe(liveCount)
    expect(persisted.filter((a) => a.detached === true).length).toBe(detachedCount)
  })
})
