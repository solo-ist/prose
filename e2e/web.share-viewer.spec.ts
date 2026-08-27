/**
 * Share-artifact viewer e2e (#768) — verifies the self-contained HTML artifact
 * produced by buildProseHtml/buildShareHtml: embedded blocks round-trip, the
 * inline viewer renders the comment rail from file:// (offline read-only mode),
 * comment content is rendered inert (no HTML/script injection), and plain
 * exports without comments stay viewer-free.
 *
 * These tests run the REAL builder (imported into the Node test context) and
 * the REAL inline viewer (inside the generated artifact) — no fixtures that
 * can drift from the implementation.
 */

import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildProseHtml,
  buildShareHtml,
  isProseHtml,
  extractMarkdownFromHtml,
  extractCommentsFromHtml,
  extractShareConfigFromHtml,
} from '../src/renderer/lib/htmlExport'
import type { CommentData } from '../src/renderer/extensions/comments/types'

const XSS_TEXT = '<script>alert(1)</script><img src=x onerror=alert(2)>'

const MARKDOWN = [
  '# Share Test',
  '',
  'The quick brown fox jumps over the lazy dog.',
  '',
  'Another paragraph with notable text inside.',
].join('\n')

const EDITOR_HTML = [
  '<h1>Share Test</h1>',
  '<p>The <span data-comment-id="c1" data-comment="Nice phrase" class="comment-mark">quick brown fox</span> jumps over the lazy dog.</p>',
  '<p>Another paragraph with <span data-comment-id="c2" class="comment-mark">notable text</span> inside.</p>',
].join('\n')

const COMMENTS: CommentData[] = [
  {
    id: 'c1',
    markedText: 'quick brown fox',
    comment: 'Nice phrase',
    createdAt: 1756200000000,
    author: 'user',
    occurrenceIndex: 0,
    from: 5,
    to: 20,
    replies: [
      { id: 'r1', author: 'user', text: 'Agreed — keep it.', createdAt: 1756200100000, authorName: 'Reviewer Rae' },
    ],
  },
  {
    id: 'c2',
    markedText: 'notable text',
    comment: XSS_TEXT,
    createdAt: 1756200200000,
    author: 'user',
    occurrenceIndex: 0,
    from: 60,
    to: 72,
    replies: [],
  },
  {
    id: 'c3',
    markedText: 'lazy dog',
    comment: 'This thread was resolved.',
    createdAt: 1756200300000,
    author: 'ai',
    occurrenceIndex: 0,
    from: 30,
    to: 38,
    replies: [],
    resolved: true,
  },
]

let artifactUrl: string
let shareArtifactUrl: string
let artifactHtml: string
let shareArtifactHtml: string

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prose-share-'))
  artifactHtml = await buildProseHtml(EDITOR_HTML, MARKDOWN, {}, 'Share Test', null, COMMENTS)
  shareArtifactHtml = await buildShareHtml(
    EDITOR_HTML,
    MARKDOWN,
    {},
    'Share Test',
    null,
    COMMENTS,
    'https://prose.solo.ist'
  )
  const artifactPath = join(dir, 'artifact.html')
  const sharePath = join(dir, 'share-artifact.html')
  writeFileSync(artifactPath, artifactHtml, 'utf-8')
  writeFileSync(sharePath, shareArtifactHtml, 'utf-8')
  artifactUrl = pathToFileURL(artifactPath).href
  shareArtifactUrl = pathToFileURL(sharePath).href
})

test.describe('artifact format', () => {
  test('round-trips markdown and comments through the embedded blocks', () => {
    expect(isProseHtml(artifactHtml)).toBe(true)
    expect(extractMarkdownFromHtml(artifactHtml)).toContain('quick brown fox')

    const block = extractCommentsFromHtml(artifactHtml)
    expect(block).not.toBeNull()
    expect(block!.version).toBe(1)
    expect(block!.publishRev).toMatch(/^[0-9a-f]{16}$/)
    expect(block!.comments).toHaveLength(3)
    expect(block!.comments[0].replies?.[0]?.authorName).toBe('Reviewer Rae')
    expect(block!.comments[1].comment).toBe(XSS_TEXT)
    expect(block!.comments[2].resolved).toBe(true)
  })

  test('local export has no share config; share artifact has one without a token', () => {
    expect(extractShareConfigFromHtml(artifactHtml)).toBeNull()

    const config = extractShareConfigFromHtml(shareArtifactHtml)
    expect(config).not.toBeNull()
    expect(config!.shareEndpoint).toBe('https://prose.solo.ist')
    expect(config!.publishRev).toMatch(/^[0-9a-f]{16}$/)
    // The capability token must never be embedded in the artifact — the share
    // config carries exactly endpoint + rev + timestamp, nothing else.
    expect(Object.keys(config!).sort()).toEqual(['publishRev', 'publishedAt', 'shareEndpoint'])
  })

  test('publishRev is content-derived: same content, same rev', async () => {
    const again = await buildProseHtml(EDITOR_HTML, MARKDOWN, {}, 'Share Test', null, COMMENTS)
    expect(extractCommentsFromHtml(again)!.publishRev).toBe(extractCommentsFromHtml(artifactHtml)!.publishRev)

    const changed = await buildProseHtml(EDITOR_HTML, MARKDOWN + '\nMore.', {}, 'Share Test', null, COMMENTS)
    expect(extractCommentsFromHtml(changed)!.publishRev).not.toBe(extractCommentsFromHtml(artifactHtml)!.publishRev)
  })

  test('export without comments is viewer-free and stays re-importable', async () => {
    const plain = await buildProseHtml(EDITOR_HTML, MARKDOWN, {}, 'Share Test', null)
    expect(isProseHtml(plain)).toBe(true)
    expect(extractMarkdownFromHtml(plain)).toContain('quick brown fox')
    expect(plain).not.toContain('application/x-prose-comments')
    expect(plain).not.toContain('prose-comment-rail')
  })
})

test.describe('inline viewer from file:// (offline read-only)', () => {
  let dialogAppeared: boolean

  test.beforeEach(async ({ page }) => {
    // Track any dialog — comment content executing as script would alert().
    dialogAppeared = false
    page.on('dialog', async (dialog) => {
      dialogAppeared = true
      await dialog.dismiss()
    })
    await page.goto(artifactUrl)
  })

  test('renders the comment rail with open and resolved threads', async ({ page }) => {
    const rail = page.locator('#prose-comment-rail')
    await expect(rail).toBeVisible()
    await expect(rail.getByRole('heading', { name: 'Comments (2)' })).toBeVisible()
    await expect(rail.getByRole('heading', { name: 'Resolved (1)' })).toBeVisible()
    await expect(rail.locator('.prose-thread-quote').first()).toHaveText('quick brown fox')
    await expect(rail.getByText('Agreed — keep it.')).toBeVisible()
    await expect(rail.getByText('Reviewer Rae', { exact: false })).toBeVisible()
    await expect(page.locator('#prose-rail-toggle')).toHaveText('💬 2')
  })

  test('renders hostile comment content inert', async ({ page }) => {
    const xssThread = page.locator('.prose-thread[data-thread-id="c2"]')
    // The literal text is displayed…
    await expect(xssThread.locator('.prose-thread-body').first()).toHaveText(XSS_TEXT)
    // …and never became DOM: no injected img node anywhere in the rail, and
    // no alert() fired from either payload.
    expect(await page.locator('#prose-comment-rail img').count()).toBe(0)
    expect(dialogAppeared).toBe(false)
  })

  test('clicking a rail thread activates its highlight in the document', async ({ page }) => {
    await page.locator('.prose-thread[data-thread-id="c1"]').click()
    await expect(page.locator('article span[data-comment-id="c1"]')).toHaveClass(/prose-viewer-active/)
    await expect(page.locator('.prose-thread[data-thread-id="c1"]')).toHaveClass(/prose-viewer-active/)
  })

  test('clicking a highlight activates its rail thread', async ({ page }) => {
    await page.locator('article span[data-comment-id="c2"]').click()
    await expect(page.locator('.prose-thread[data-thread-id="c2"]')).toHaveClass(/prose-viewer-active/)
  })

  test('offline mode: no add-comment affordance, read-only note shown', async ({ page }) => {
    await expect(page.locator('#prose-comment-rail .prose-rail-note')).toContainText('Read-only copy')

    // Select text in the article — no add-comment button may appear offline.
    const paragraph = page.locator('article p').first()
    await paragraph.click({ clickCount: 3 })
    await page.waitForTimeout(100)
    expect(await page.locator('#prose-add-comment-btn').count()).toBe(0)
  })

  test('rail toggle hides and shows the rail', async ({ page }) => {
    await expect(page.locator('#prose-comment-rail')).toBeVisible()
    await page.locator('#prose-rail-toggle').click()
    await expect(page.locator('#prose-comment-rail')).toHaveCount(0)
    await page.locator('#prose-rail-toggle').click()
    await expect(page.locator('#prose-comment-rail')).toBeVisible()
  })
})

test.describe('share artifact opened locally', () => {
  test('stays offline (file:// wins over share config) with the local-copy banner', async ({ page }) => {
    await page.goto(shareArtifactUrl)
    await expect(page.locator('#prose-comment-rail')).toBeVisible()
    await expect(page.locator('#prose-comment-rail .prose-rail-note')).toContainText('local copy')

    const paragraph = page.locator('article p').first()
    await paragraph.click({ clickCount: 3 })
    await page.waitForTimeout(100)
    expect(await page.locator('#prose-add-comment-btn').count()).toBe(0)
  })
})
