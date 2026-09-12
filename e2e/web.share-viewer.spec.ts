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
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
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
let tmpDir: string

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prose-share-'))
  tmpDir = dir
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

  test('pushed replies bake under their server id; shareId is never embedded', async () => {
    // Dedupe invariant (#769): a reply with shareId (already pushed to the
    // gateway) must appear in the artifact under the server row id, so the
    // baked copy and the live-poll row are one id and the viewer can't show
    // it twice. shareId itself is local bookkeeping and stays out of the file.
    const withPushed: CommentData[] = [
      {
        ...COMMENTS[0],
        replies: [
          { id: 'local-1', author: 'user', text: 'On it.', createdAt: 1756200400000, shareId: 'srv-1' },
          { id: 'local-2', author: 'user', text: 'Not pushed yet.', createdAt: 1756200500000 },
        ],
      },
    ]
    const baked = await buildProseHtml(EDITOR_HTML, MARKDOWN, {}, 'Share Test', null, withPushed)
    const replies = extractCommentsFromHtml(baked)!.comments[0].replies!
    expect(replies.map((r) => r.id)).toEqual(['srv-1', 'local-2'])
    expect(replies.every((r) => !('shareId' in r))).toBe(true)
  })

  test('pushed threads bake under their server id; shareId is never embedded', async () => {
    // The same invariant at thread level: an author comment pushed live from
    // the desktop bakes under its gateway row id, so the baked row and the
    // live-poll row are one identity in the viewer merge.
    const withPushed: CommentData[] = [{ ...COMMENTS[0], shareId: 'srv-t1' }, COMMENTS[1]]
    const baked = await buildProseHtml(EDITOR_HTML, MARKDOWN, {}, 'Share Test', null, withPushed)
    const threads = extractCommentsFromHtml(baked)!.comments
    expect(threads.map((t) => t.id)).toEqual(['srv-t1', 'c2'])
    expect(threads.every((t) => !('shareId' in t))).toBe(true)
  })

  test('export without comments is viewer-free and stays re-importable', async () => {
    const plain = await buildProseHtml(EDITOR_HTML, MARKDOWN, {}, 'Share Test', null)
    expect(isProseHtml(plain)).toBe(true)
    expect(extractMarkdownFromHtml(plain)).toContain('quick brown fox')
    expect(plain).not.toContain('application/x-prose-comments')
    expect(plain).not.toContain('prose-comment-rail')
    expect(plain).not.toContain('prose-doc-header')
  })

  test('sanitizer strips C0/C1 control chars, preserves ordinary text and \\t \\n \\u00a0', async () => {
    // PE review of PR #852 asked for proof the CONTROL_CHARS regex matches
    // real control codes, not literal ^-notation characters.
    const hostile = 'abcde ^ @ A H tab\there nb sp\nnext'
    const withCtl: CommentData[] = [
      {
        id: 'x1',
        markedText: 'quick brown fox',
        comment: hostile,
        createdAt: 1,
        from: 0,
        to: 0,
        replies: [{ id: 'xr1', author: 'user', text: hostile, createdAt: 2, authorName: 'Name' }],
      },
    ]
    const html = await buildProseHtml(EDITOR_HTML, MARKDOWN, {}, 'Share Test', null, withCtl)
    const block = extractCommentsFromHtml(html)
    expect(block).not.toBeNull()
    const expected = 'abcde ^ @ A H tab\there nb sp\nnext'
    expect(block!.comments[0].comment).toBe(expected)
    expect(block!.comments[0].replies?.[0]?.text).toBe(expected)
    expect(block!.comments[0].replies?.[0]?.authorName).toBe('Name')
  })

  test('anchor-normalization parity tripwire: viewer norm matches restoreComments', () => {
    // The viewer computes anchors with the SAME normalization as the editor's
    // restoreComments — ASCII space (U+0020) strip only. If either side
    // changes, occurrence indexes desync and reviewer comments anchor to the
    // wrong text. This tripwire fails if either site's normalization drifts;
    // change both together.
    const viewerSrc = readFileSync(
      join(process.cwd(), 'src/renderer/lib/viewerScript.ts'),
      'utf-8'
    )
    const editorSrc = readFileSync(
      join(process.cwd(), 'src/renderer/extensions/comments/extension.ts'),
      'utf-8'
    )
    expect(viewerSrc).toContain("function norm(s) { return s.replace(/ /g, '') }")
    // restoreComments normalizes both the stored markedText and docText the
    // same way; both call sites must be present.
    expect((editorSrc.match(/\.replace\(\/ \/g, ''\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
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

  test('file:// shows the local-copy banner; the panel note explains the file loop', async ({ page }) => {
    await expect(page.locator('#prose-file-banner')).toContainText('Local copy')
    await expect(page.locator('#prose-comment-rail .prose-rail-note')).toContainText('download the annotated copy')
  })

  test('renders the comment rail with open and resolved threads', async ({ page }) => {
    const rail = page.locator('#prose-comment-rail')
    await expect(rail).toBeVisible()
    await expect(rail.locator('.prose-rail-head')).toContainText('Comments · 2')
    await expect(rail.getByText('Agreed — keep it.')).toBeVisible()
    await expect(rail.getByText('Reviewer Rae', { exact: false })).toBeVisible()
    await expect(page.locator('#prose-rail-toggle')).toHaveText('2 comments')
    // Resolved section: collapsed by default, expands to the struck quote.
    await expect(rail.locator('.prose-resolved-head')).toContainText('Resolved · 1')
    await expect(rail.locator('.prose-resolved-section .prose-thread')).toHaveCount(0)
    await rail.locator('.prose-resolved-toggle').click()
    await expect(rail.locator('.prose-resolved-section .prose-thread-quote')).toHaveText('“lazy dog”')
    await expect(rail.getByText('This thread was resolved.')).toBeVisible()
  })

  test('the panel floats fixed on the right with cards in document order', async ({ page }) => {
    const c1 = page.locator('.prose-thread[data-thread-id="c1"]')
    const c2 = page.locator('.prose-thread[data-thread-id="c2"]')
    await expect(c1).toBeVisible()
    await expect(c2).toBeVisible()
    // The panel is a fixed floating surface, not part of the page flow.
    const position = await page.locator('#prose-comment-rail').evaluate((node) => getComputedStyle(node).position)
    expect(position).toBe('fixed')
    // Cards are normal flow inside the scroll body (no absolute stacking)…
    const top1 = await c1.evaluate((node) => (node as HTMLElement).style.top)
    expect(top1).toBe('')
    // …ordered by where their marks appear in the document: c1 before c2.
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.prose-open-section .prose-thread')).map((n) => n.getAttribute('data-thread-id'))
    )
    expect(order).toEqual(['c1', 'c2'])
    // Every open card carries its quote — the panel sits apart from the marks.
    await expect(c1.locator('.prose-thread-quote')).toHaveText('“quick brown fox”')
  })

  test('focus mode shows one thread at a time; nav wraps; mark click retargets', async ({ page }) => {
    await page.locator('.prose-rail-mode button', { hasText: 'focus' }).click()
    // One card + position indicator, first thread in document order.
    await expect(page.locator('.prose-open-section .prose-thread')).toHaveCount(1)
    await expect(page.locator('.prose-open-section .prose-thread')).toHaveAttribute('data-thread-id', 'c1')
    await expect(page.locator('.prose-focus-nav')).toContainText('1 of 2')
    // Resolved section is a list-mode surface.
    await expect(page.locator('.prose-resolved-head')).toHaveCount(0)
    // Next → c2, next again wraps to c1.
    await page.locator('.prose-focus-nav button').nth(1).click()
    await expect(page.locator('.prose-open-section .prose-thread')).toHaveAttribute('data-thread-id', 'c2')
    await expect(page.locator('.prose-focus-nav')).toContainText('2 of 2')
    await page.locator('.prose-focus-nav button').nth(1).click()
    await expect(page.locator('.prose-open-section .prose-thread')).toHaveAttribute('data-thread-id', 'c1')
    // Clicking a mark focuses its thread.
    await page.locator('article span[data-comment-id="c2"]').click()
    await expect(page.locator('.prose-open-section .prose-thread')).toHaveAttribute('data-thread-id', 'c2')
    await expect(page.locator('.prose-open-section .prose-thread')).toHaveClass(/prose-viewer-active/)
    // Back to list mode: both cards return.
    await page.locator('.prose-rail-mode button', { hasText: 'list' }).click()
    await expect(page.locator('.prose-open-section .prose-thread')).toHaveCount(2)
    await expect(page.locator('.prose-resolved-head')).toContainText('Resolved · 1')
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

  test('offline mode: selecting text offers add-comment; form has no email field', async ({ page }) => {
    await expect(page.locator('#prose-comment-rail .prose-rail-note')).toContainText('download the annotated copy')

    const paragraph = page.locator('article p').first()
    await paragraph.click({ clickCount: 3 })
    await expect(page.locator('#prose-add-comment-btn')).toBeVisible()

    await page.locator('#prose-add-comment-btn').click()
    const form = page.locator('#prose-comment-form')
    await expect(form).toBeVisible()
    // Offline: name + comment only — the notification-email field is online-only.
    expect(await form.locator('input').count()).toBe(1)
  })

  test('offline add-comment lands in the rail and arms the download button', async ({ page }) => {
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await page.locator('#prose-comment-form input').fill('Offline Olive')
    await page.locator('#prose-comment-form textarea').fill('Added without any server.')
    await page.locator('#prose-comment-form button', { hasText: 'Add' }).first().click()

    await expect(page.locator('.prose-rail-head')).toContainText('Comments · 3')
    await expect(page.getByText('Added without any server.')).toBeVisible()
    await expect(page.getByText('Offline Olive', { exact: false })).toBeVisible()
    // Local footer: the save offer appears only once there is something new.
    await expect(page.locator('#prose-download-copy')).toHaveText('Save updated copy (1 new)')
  })

  test('the local footer offers no download when the page holds nothing new', async ({ page }) => {
    await expect(page.locator('.prose-rail-head')).toContainText('Comments · 2')
    await expect(page.locator('#prose-download-copy')).toBeHidden()
  })

  test('an offline reply lands in the thread, arms the download, bakes into the copy', async ({ page }) => {
    const c1 = page.locator('.prose-thread[data-thread-id="c1"]')
    await c1.locator('.prose-reply-link').click()
    await c1.locator('.prose-reply-composer input').fill('Reply Riley')
    await c1.locator('.prose-reply-composer textarea').fill('Offline reply here.')
    await c1.locator('.prose-reply-actions button', { hasText: 'Reply' }).first().click()

    await expect(c1.getByText('Offline reply here.')).toBeVisible()
    await expect(page.locator('#prose-download-copy')).toContainText('(1 new)')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#prose-download-copy').click(),
    ])
    const savedPath = join(tmpDir, 'reply-annotated.html')
    await download.saveAs(savedPath)
    const block = extractCommentsFromHtml(readFileSync(savedPath, 'utf-8'))
    const replies = block!.comments.find((c) => c.id === 'c1')!.replies!
    const added = replies.find((r) => r.text === 'Offline reply here.')
    expect(added?.authorName).toBe('Reply Riley')
  })

  test('⌘↵ / Ctrl+Enter submits the comment form', async ({ page }) => {
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await page.locator('#prose-comment-form input').fill('Keyboard Kai')
    const textarea = page.locator('#prose-comment-form textarea')
    await textarea.fill('Submitted by keyboard.')
    await textarea.press('Control+Enter')
    await expect(page.locator('.prose-rail-head')).toContainText('Comments · 3')
    await expect(page.getByText('Submitted by keyboard.')).toBeVisible()
  })

  test('download annotated copy: valid artifact carrying the new comment, reopenable', async ({ page }) => {
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await page.locator('#prose-comment-form input').fill('Offline Olive')
    await page.locator('#prose-comment-form textarea').fill('Round-trip me.')
    await page.locator('#prose-comment-form button', { hasText: 'Add' }).first().click()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#prose-download-copy').click(),
    ])
    expect(download.suggestedFilename()).toContain('-annotated')
    const savedPath = join(tmpDir, 'annotated.html')
    await download.saveAs(savedPath)
    const annotatedHtml = readFileSync(savedPath, 'utf-8')

    // Still a fully valid Prose artifact: markdown block intact, comments
    // block now carries the original threads + the offline addition.
    expect(isProseHtml(annotatedHtml)).toBe(true)
    expect(extractMarkdownFromHtml(annotatedHtml)).toContain('quick brown fox')
    const block = extractCommentsFromHtml(annotatedHtml)
    expect(block).not.toBeNull()
    expect(block!.comments).toHaveLength(4)
    const added = block!.comments.find((c) => c.comment === 'Round-trip me.')
    expect(added?.authorName).toBe('Offline Olive')
    expect((added?.markedText ?? '').length).toBeGreaterThan(0)
    // No viewer runtime DOM leaked into the copy.
    expect(annotatedHtml).not.toContain('id="prose-comment-rail"')

    // The annotated copy reopens as a working artifact with the new thread.
    await page.goto(pathToFileURL(savedPath).href)
    await expect(page.locator('.prose-rail-head')).toContainText('Comments · 3')
    await expect(page.getByText('Round-trip me.')).toBeVisible()
  })

  test('rail toggle hides and shows the rail', async ({ page }) => {
    await expect(page.locator('#prose-comment-rail')).toBeVisible()
    await page.locator('#prose-rail-toggle').click()
    await expect(page.locator('#prose-comment-rail')).toHaveCount(0)
    await page.locator('#prose-rail-toggle').click()
    await expect(page.locator('#prose-comment-rail')).toBeVisible()
  })
})

test.describe('theme', () => {
  test('follows prefers-color-scheme by default, before first paint', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(artifactUrl)
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.emulateMedia({ colorScheme: 'light' })
    await page.reload()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  })

  test('a stored preference wins over the media query', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(artifactUrl)
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.evaluate(() => window.localStorage.setItem('prose-viewer-theme', 'light'))
    await page.reload()
    await expect(page.locator('html')).not.toHaveClass(/dark/)

    await page.evaluate(() => window.localStorage.removeItem('prose-viewer-theme'))
  })
})

test.describe('baked chrome', () => {
  test('top bar, eyebrow, end mark and footer render around the article', async ({ page }) => {
    await page.goto(artifactUrl)
    await expect(page.locator('.prose-wordmark')).toHaveText('¶Prose.')
    await expect(page.locator('.prose-doc-eyebrow')).toHaveText(/^[A-Z][a-z]+ \d{4}$/)
    await expect(page.locator('.prose-end-mark')).toHaveText('— End')
    await expect(page.locator('.prose-artifact-footer')).toContainText('Shared with Prose')
    await expect(page.locator('#prose-download-copy')).toHaveText('Download annotated copy')
  })

  test('chrome text stays outside <article> (anchor purity guard)', async ({ page }) => {
    // computeAnchor (viewer) and restoreComments (desktop) both normalize
    // article text — any chrome text inside <article> silently shifts every
    // occurrence index. This pins the D1 shell invariant.
    await page.goto(artifactUrl)
    const articleText = await page.evaluate(() => document.querySelector('article')?.textContent ?? '')
    expect(articleText).toContain('quick brown fox')
    expect(articleText).not.toContain('— End')
    expect(articleText).not.toContain('Shared with Prose')
    expect(articleText).not.toMatch(/[A-Z][a-z]+ \d{4}/)
  })

  test('a doc without a leading H1 gets the derived title baked into the header', async ({ page }) => {
    const noH1Html = [
      '<p>The <span data-comment-id="c1" class="comment-mark">quick brown fox</span> jumps.</p>',
    ].join('\n')
    const html = await buildProseHtml(noH1Html, 'The quick brown fox jumps.', {}, 'Derived Title', null, [])
    const file = join(tmpDir, 'no-h1.html')
    writeFileSync(file, html, 'utf-8')
    await page.goto(pathToFileURL(file).href)

    await expect(page.locator('.prose-doc-title')).toHaveText('Derived Title')
    // The injected title lives in the header, never inside the article.
    const articleText = await page.evaluate(() => document.querySelector('article')?.textContent ?? '')
    expect(articleText).not.toContain('Derived Title')
    // The fixture doc DOES lead with an H1 — no title injection there.
    await page.goto(artifactUrl)
    await expect(page.locator('.prose-doc-title')).toHaveCount(0)
  })
})

test.describe('client-side anchoring', () => {
  const anchorComment = (over: Partial<CommentData>): CommentData => ({
    id: 'm1',
    markedText: '',
    comment: 'Anchor me.',
    createdAt: 1756200000000,
    author: 'user',
    occurrenceIndex: 0,
    from: 0,
    to: 0,
    replies: [],
    ...over,
  })

  const openAnchorArtifact = async (
    page: import('@playwright/test').Page,
    editorHtml: string,
    comment: CommentData,
    name: string
  ) => {
    const html = await buildProseHtml(editorHtml, 'anchor fixture', {}, 'Anchor Test', null, [comment])
    const file = join(tmpDir, name)
    writeFileSync(file, html, 'utf-8')
    await page.goto(pathToFileURL(file).href)
  }

  test('a thread with no baked span anchors to its text on load', async ({ page }) => {
    await openAnchorArtifact(
      page,
      '<p>Alpha beta gamma delta.</p><p>Second alpha beta here.</p>',
      anchorComment({ markedText: 'beta gamma' }),
      'anchor-basic.html'
    )
    const span = page.locator('article span[data-comment-id="m1"]')
    await expect(span).toHaveText('beta gamma')
    await expect(page.locator('.prose-lost-section .prose-thread')).toHaveCount(0)
  })

  test('cross-element marks wrap every covered segment under one id', async ({ page }) => {
    await openAnchorArtifact(
      page,
      '<p>one <em>two</em> three ends.</p>',
      anchorComment({ markedText: 'one two three' }),
      'anchor-cross.html'
    )
    const spans = page.locator('article span[data-comment-id="m1"]')
    await expect(spans.first()).toBeVisible()
    expect(await spans.count()).toBeGreaterThanOrEqual(2)
    const joined = await page.evaluate(() => {
      const parts = Array.from(document.querySelectorAll('article span[data-comment-id="m1"]'))
      return parts.map((s) => s.textContent).join('')
    })
    expect(joined.replace(/ /g, '')).toBe('onetwothree')
    // Clicking the thread activates every segment.
    await page.locator('.prose-thread[data-thread-id="m1"]').click()
    for (const span of await spans.all()) {
      await expect(span).toHaveClass(/prose-viewer-active/)
    }
  })

  test('occurrenceIndex picks the nth occurrence', async ({ page }) => {
    await openAnchorArtifact(
      page,
      '<p>dup phrase here. dup phrase again.</p>',
      anchorComment({ markedText: 'dup phrase', occurrenceIndex: 1 }),
      'anchor-nth.html'
    )
    const span = page.locator('article span[data-comment-id="m1"]')
    await expect(span).toHaveText('dup phrase')
    const before = await page.evaluate(() => {
      const mark = document.querySelector('article span[data-comment-id="m1"]')!
      const range = document.createRange()
      range.selectNodeContents(document.querySelector('article')!)
      range.setEndBefore(mark)
      return range.toString()
    })
    expect(before).toContain('dup phrase here')
  })

  test('unmatchable markedText lands in Lost their place', async ({ page }) => {
    await openAnchorArtifact(
      page,
      '<p>Nothing matches in this document.</p>',
      anchorComment({ markedText: 'vanished passage' }),
      'anchor-lost.html'
    )
    await expect(page.locator('.prose-lost-head')).toContainText('Lost their place · 1')
    const lostCard = page.locator('.prose-lost-section .prose-thread-lost')
    await expect(lostCard.locator('.prose-thread-quote')).toHaveText('“vanished passage”')
    await expect(lostCard.locator('.prose-lost-note')).toHaveText('This passage is no longer in the document.')
    // Lost threads are excluded from the open conversation count.
    await expect(page.locator('.prose-rail-head')).toContainText('Comments · 0')
    expect(await page.locator('article span[data-comment-id="m1"]').count()).toBe(0)
  })
})

test.describe('author reply styling (offline)', () => {
  test('baked author replies (no authorName) render with the author tag', async ({ page }) => {
    const withAuthorReply: CommentData[] = [
      {
        ...COMMENTS[0],
        replies: [
          { id: 'r1', author: 'user', text: 'Agreed — keep it.', createdAt: 1756200100000, authorName: 'Reviewer Rae' },
          { id: 'srv-9', author: 'user', text: 'Done in the next rev.', createdAt: 1756200200000 },
        ],
      },
    ]
    const html = await buildProseHtml(EDITOR_HTML, MARKDOWN, {}, 'Share Test', null, withAuthorReply)
    const file = join(tmpDir, 'author-reply.html')
    writeFileSync(file, html, 'utf-8')
    await page.goto(pathToFileURL(file).href)

    const authorReply = page.locator('.prose-thread-reply.prose-reply-author')
    await expect(authorReply).toHaveCount(1)
    await expect(authorReply).toContainText('Done in the next rev.')
    await expect(authorReply.locator('.prose-author-tag')).toHaveText('· author')
    // The reviewer reply stays unstyled.
    const reviewerReply = page.locator('.prose-thread-reply', { hasText: 'Agreed — keep it.' })
    await expect(reviewerReply).not.toHaveClass(/prose-reply-author/)
  })
})

test.describe('live conversation loop (online viewer)', () => {
  // A tiny http harness standing in for the gateway's /s/:token surface. It
  // serves the REAL artifact with the REAL CSP (mirrors ARTIFACT_HEADERS in
  // gateway/src/routes/share/public.ts — a same-origin regression here means
  // the live poll is CSP-blocked in production too) and scripts the comment
  // list across polls.
  const CSP =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: blob:; font-src data: https://fonts.gstatic.com; connect-src 'self'"

  let server: import('node:http').Server
  let origin: string
  let commentRows: Array<Record<string, unknown>> = []
  let postedRows: Array<Record<string, unknown>> = []
  // authorEmail from each comment POST body, by index — the GET rows must
  // never carry it (mirrors publicComment excluding it), so assert here.
  let postedEmails: Array<string | undefined> = []
  let post429RetryAfter = 0
  let post500 = false
  let commentsGone = false

  const row = (over: Record<string, unknown>): Record<string, unknown> => ({
    parentId: null,
    markedText: '',
    occurrenceIndex: 0,
    commentText: '',
    authorName: 'Angel Web',
    fromAuthor: false,
    resolvedAt: null,
    publishRev: 'rev',
    createdAt: '2026-09-07T00:00:00.000Z',
    ...over,
  })

  test.beforeAll(async () => {
    const { createServer } = await import('node:http')
    let artifactHtmlOnline = ''
    // Mirrors the gateway's CORS posture on /s/* (hono/cors, origin *): this
    // is what lets a downloaded file:// copy (Origin: null) publish comments.
    const corsJson = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    server = createServer((req, res) => {
      const url = req.url ?? ''
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        })
        res.end()
        return
      }
      if (req.method === 'GET' && url === '/s/testtoken') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP })
        res.end(artifactHtmlOnline)
      } else if (req.method === 'GET' && url.startsWith('/s/testtoken/comments')) {
        if (commentsGone) {
          res.writeHead(410, corsJson)
          res.end(JSON.stringify({ error: 'revoked' }))
          return
        }
        res.writeHead(200, corsJson)
        res.end(JSON.stringify({ comments: [...commentRows, ...postedRows], nextCursor: null }))
      } else if (req.method === 'POST' && url === '/s/testtoken/comments') {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          if (post500) {
            res.writeHead(500, corsJson)
            res.end(JSON.stringify({ error: 'internal_error' }))
            return
          }
          if (post429RetryAfter > 0) {
            const retryAfter = post429RetryAfter
            post429RetryAfter = 0
            res.writeHead(429, { ...corsJson, 'Retry-After': String(retryAfter) })
            res.end(JSON.stringify({ error: 'rate_limited', retryAfter }))
            return
          }
          const parsed = JSON.parse(body) as { commentText: string; markedText: string; occurrenceIndex: number; authorName: string; authorEmail?: string }
          postedEmails.push(parsed.authorEmail)
          const id = `srv-posted-${postedRows.length + 1}`
          postedRows.push(row({
            id,
            markedText: parsed.markedText,
            occurrenceIndex: parsed.occurrenceIndex,
            commentText: parsed.commentText,
            authorName: parsed.authorName,
            createdAt: '2026-09-07T00:05:00.000Z',
          }))
          res.writeHead(201, corsJson)
          res.end(JSON.stringify({ id, createdAt: '2026-09-07T00:05:00.000Z' }))
        })
      } else if (req.method === 'POST' && /^\/s\/testtoken\/comments\/[^/]+\/replies$/.test(url)) {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          if (post500) {
            res.writeHead(500, corsJson)
            res.end(JSON.stringify({ error: 'internal_error' }))
            return
          }
          const parsed = JSON.parse(body) as { commentText: string; authorName: string }
          const parentId = url.split('/')[4]
          const id = `srv-reply-${postedRows.length + 1}`
          postedRows.push(row({
            id,
            parentId,
            commentText: parsed.commentText,
            authorName: parsed.authorName,
            createdAt: '2026-09-07T00:06:00.000Z',
          }))
          res.writeHead(201, corsJson)
          res.end(JSON.stringify({ id, createdAt: '2026-09-07T00:06:00.000Z' }))
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no server address')
    origin = `http://127.0.0.1:${address.port}`

    // c1 carries a pushed author reply (shareId srv-1) — baked under the
    // server id, so the live GET returning the same row must not double it.
    const online: CommentData[] = [
      {
        ...COMMENTS[0],
        replies: [
          { id: 'local-1', author: 'user', text: 'On it.', createdAt: 1756200100000, shareId: 'srv-1' },
        ],
      },
    ]
    artifactHtmlOnline = await buildShareHtml(EDITOR_HTML, MARKDOWN, {}, 'Share Test', null, online, origin)
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test.beforeEach(() => {
    postedRows = []
    postedEmails = []
    post429RetryAfter = 0
    post500 = false
    commentsGone = false
    commentRows = [
      // The pushed author reply, now a gateway row.
      row({ id: 'srv-1', parentId: 'c1', commentText: 'On it.', authorName: 'Angel', fromAuthor: true, createdAt: '2026-09-06T00:00:00.000Z' }),
      // A reviewer thread that exists only on the gateway (posted after bake).
      row({ id: 'srv-2', markedText: 'lazy dog', commentText: 'Live-only thread.', createdAt: '2026-09-06T01:00:00.000Z' }),
      // A reviewer reply to it.
      row({ id: 'srv-3', parentId: 'srv-2', commentText: 'Live reply.', authorName: 'Second Reviewer', createdAt: '2026-09-06T02:00:00.000Z' }),
    ]
  })

  test('initial poll merges live-only threads and never duplicates the baked author reply', async ({ page }) => {
    await page.goto(`${origin}/s/testtoken`)
    await expect(page.locator('.prose-thread', { hasText: 'Live-only thread.' })).toBeVisible()
    await expect(page.getByText('Live reply.')).toBeVisible()
    // Baked + live-GET copies of srv-1 collapse into one reply.
    await expect(page.getByText('On it.')).toHaveCount(1)
    await expect(page.locator('.prose-thread-reply.prose-reply-author')).toHaveCount(1)
    // The live-only thread anchors to its text — no baked span needed.
    await expect(page.locator('article span[data-comment-id="srv-2"]')).toHaveText('lazy dog')
    // The local-copy banner is a file:// posture — never shown when served.
    await expect(page.locator('#prose-file-banner')).toHaveCount(0)
  })

  test('a resolve landing between polls moves the thread to Resolved on focus', async ({ page }) => {
    await page.goto(`${origin}/s/testtoken`)
    await expect(page.locator('.prose-thread', { hasText: 'Live-only thread.' })).toBeVisible()
    await expect(page.locator('.prose-resolved-section .prose-thread')).toHaveCount(0)

    commentRows = commentRows.map((r) => (r.id === 'srv-2' ? { ...r, resolvedAt: '2026-09-07T03:00:00.000Z' } : r))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.locator('.prose-resolved-head')).toContainText('Resolved · 1')
    await page.locator('.prose-resolved-toggle').click()
    await expect(page.locator('.prose-resolved-section .prose-thread', { hasText: 'Live-only thread.' })).toBeVisible()
    await expect(page.locator('.prose-rail-head')).toContainText('Comments · 1')
  })

  test('a posted comment is not duplicated by the follow-up poll', async ({ page }) => {
    await page.goto(`${origin}/s/testtoken`)
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await page.locator('#prose-comment-form input').first().fill('Poster Pat')
    await page.locator('#prose-comment-form textarea').fill('Posted live.')
    await page.locator('#prose-comment-form button', { hasText: 'Post' }).first().click()
    await expect(page.getByText('Posted live.')).toBeVisible()

    // Force the next poll (instead of waiting out the 2s refetch) and give the
    // merge a beat — the posted row comes back from the server by its id.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(300)
    await expect(page.getByText('Posted live.')).toHaveCount(1)
  })

  test('a reply posts to the public route and is not duplicated by the next poll', async ({ page }) => {
    await page.goto(`${origin}/s/testtoken`)
    const thread = page.locator('.prose-thread', { hasText: 'Live-only thread.' })
    await thread.locator('.prose-reply-link').click()
    // Fresh context has no stored commenter name — the composer asks for one.
    await thread.locator('.prose-reply-composer input').fill('Reply Rae')
    await thread.locator('.prose-reply-composer textarea').fill('From the rail.')
    await thread.locator('.prose-reply-actions button', { hasText: 'Reply' }).first().click()

    await expect(thread.getByText('From the rail.')).toBeVisible()
    await expect(thread.getByText('Reply Rae', { exact: false })).toBeVisible()
    await expect(thread.locator('.prose-author-tag', { hasText: '· you' })).toBeVisible()

    // The optimistic reply carries the server id — the next poll returns the
    // same row and the merge must not double it.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(300)
    await expect(thread.getByText('From the rail.')).toHaveCount(1)
  })

  test('a 429 shows the honest retry time and keeps the draft', async ({ page }) => {
    post429RetryAfter = 90
    await page.goto(`${origin}/s/testtoken`)
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await page.locator('#prose-comment-form input').first().fill('Limited Lee')
    await page.locator('#prose-comment-form textarea').fill('Held back once.')
    await page.locator('#prose-comment-form button', { hasText: 'Post' }).first().click()

    const error = page.locator('.prose-form-error')
    await expect(error).toContainText('Too many comments in a minute')
    await expect(error).toContainText('Try again at')
    // The draft is kept in place — a 429 is a shown error, never the
    // offline not-sent fallback.
    await expect(page.locator('#prose-comment-form textarea')).toHaveValue('Held back once.')
    await expect(page.locator('.prose-offline-card')).toHaveCount(0)
    await expect(page.locator('.prose-not-sent')).toHaveCount(0)

    // The limiter window passes (the harness 429s only once) — retry lands.
    await page.locator('#prose-comment-form button', { hasText: 'Post' }).first().click()
    await expect(page.getByText('Held back once.')).toBeVisible()
  })

  test('a failed post falls back to a not-sent local comment with recovery UI', async ({ page }) => {
    post500 = true
    await page.goto(`${origin}/s/testtoken`)
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await page.locator('#prose-comment-form input').first().fill('Stranded Sam')
    await page.locator('#prose-comment-form textarea').fill('Server was down.')
    await page.locator('#prose-comment-form button', { hasText: 'Post' }).first().click()

    // The comment lands locally: card tagged "not sent" instead of a date,
    // highlight applied to the selected text.
    const card = page.locator('.prose-thread', { hasText: 'Server was down.' })
    await expect(card).toBeVisible()
    await expect(card.locator('.prose-not-sent')).toHaveText('not sent')
    const id = await card.getAttribute('data-thread-id')
    expect(await page.locator(`article span[data-comment-id="${id}"]`).count()).toBeGreaterThan(0)

    // Recovery UI: offline chip in the rail head + explainer card + armed
    // download.
    await expect(page.locator('.prose-offline-chip')).toContainText('offline')
    await expect(page.locator('.prose-offline-card')).toContainText(
      "You're offline. 1 comment saved in this page, not on the server."
    )
    await expect(page.locator('.prose-offline-card')).toContainText('Send the file back')
    await expect(page.locator('#prose-download-copy')).toContainText('(1 new)')

    // A failed reply gets the same tag (the composer reuses the stored name).
    const thread = page.locator('.prose-thread', { hasText: 'Live-only thread.' })
    await thread.locator('.prose-reply-link').click()
    await thread.locator('.prose-reply-composer textarea').fill('Reply while down.')
    await thread.locator('.prose-reply-actions button', { hasText: 'Reply' }).first().click()
    await expect(thread.getByText('Reply while down.')).toBeVisible()
    await expect(thread.locator('.prose-not-sent')).toHaveText('not sent')
    await expect(page.locator('.prose-offline-card')).toContainText('2 comments saved in this page')

    // The not-sent additions bake into the annotated copy — the recovery path.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#prose-download-copy').click(),
    ])
    const savedPath = join(tmpDir, 'not-sent-annotated.html')
    await download.saveAs(savedPath)
    const block = extractCommentsFromHtml(readFileSync(savedPath, 'utf-8'))
    const added = block!.comments.find((c) => c.comment === 'Server was down.')
    expect(added?.authorName).toBe('Stranded Sam')
    const parent = block!.comments.find((c) => c.id === 'srv-2')
    expect(parent?.replies?.some((r) => r.text === 'Reply while down.')).toBe(true)
  })

  test('a mid-session revocation closes commenting but keeps the page readable', async ({ page }) => {
    await page.goto(`${origin}/s/testtoken`)
    await expect(page.locator('.prose-thread', { hasText: 'Live-only thread.' })).toBeVisible()
    await expect(page.locator('.prose-reply-link').first()).toBeVisible()

    commentsGone = true
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))

    // The rail note swaps to the takedown copy…
    await expect(page.locator('.prose-rail-note')).toHaveText('This link was taken down by its author.')
    // …commenting entry points close…
    await expect(page.locator('.prose-reply-link')).toHaveCount(0)
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.waitForTimeout(150)
    await expect(page.locator('#prose-add-comment-btn')).toHaveCount(0)
    // …but the document and existing conversation stay readable.
    await expect(page.locator('.prose-thread', { hasText: 'Live-only thread.' })).toBeVisible()
    await expect(page.locator('article')).toContainText('quick brown fox')
  })

  test('a served-page download without additions produces a clean copy carrying the share URL', async ({ page }) => {
    await page.goto(`${origin}/s/testtoken`)
    // Let the initial poll land so the baked comment set is deterministic.
    await expect(page.locator('.prose-thread', { hasText: 'Live-only thread.' })).toBeVisible()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#prose-download-copy').click(),
    ])
    const savedPath = join(tmpDir, 'clean-copy.html')
    await download.saveAs(savedPath)
    const copyHtml = readFileSync(savedPath, 'utf-8')
    // Baked thread + the live-merged one travel in the copy.
    expect(extractCommentsFromHtml(copyHtml)!.comments).toHaveLength(2)
    // The copy carries the full capability URL — the downloader already held
    // it — which is what lets the file:// copy publish comments back.
    expect(extractShareConfigFromHtml(copyHtml)!.shareUrl).toBe(`${origin}/s/testtoken`)
    // Runtime viewer DOM is stripped; baked chrome (top bar, footer) stays.
    expect(copyHtml).not.toContain('id="prose-comment-rail"')
    expect(copyHtml).not.toContain('id="prose-file-banner"')
    expect(copyHtml).toContain('id="prose-rail-toggle"')
    expect(copyHtml).toContain('id="prose-download-copy"')
    // The downloading viewer's theme preference must not be baked into the
    // copy — its next reader re-derives theme from their own storage/OS.
    expect(copyHtml).not.toMatch(/<html[^>]*class="[^"]*dark/)
  })

  test('a downloaded copy publishes its comments back through the baked share URL', async ({ page }) => {
    await page.goto(`${origin}/s/testtoken`)
    await expect(page.locator('.prose-thread', { hasText: 'Live-only thread.' })).toBeVisible()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#prose-download-copy').click(),
    ])
    const savedPath = join(tmpDir, 'local-publish.html')
    await download.saveAs(savedPath)

    // A reply lands on the server while the reader is away — the copy
    // carries its share URL, so its load pull brings it in immediately.
    commentRows.push(
      row({ id: 'srv-late', parentId: 'srv-2', commentText: 'Landed while offline.', authorName: 'Late Reviewer', createdAt: '2026-09-08T00:00:00.000Z' })
    )

    // Reopen from file:// — publish-capable local mode, live for reads. The
    // banner carries only the label; the note explains the publish loop.
    await page.goto(pathToFileURL(savedPath).href)
    await expect(page.locator('#prose-file-banner')).toContainText('Local copy')
    await expect(page.locator('#prose-comment-rail .prose-rail-note')).toContainText('Publish to send')
    await expect(page.locator('#prose-publish-comments')).toBeHidden()
    await expect(page.getByText('Landed while offline.')).toBeVisible()

    // A local addition is a draft: no auto-post, state + button appear. A
    // publish-capable copy offers the email field (it can reach the server).
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await expect(page.locator('#prose-comment-form input')).toHaveCount(2)
    await page.locator('#prose-comment-form input').first().fill('Local Lia')
    await page.locator('#prose-comment-form input').nth(1).fill('lia@example.com')
    await page.locator('#prose-comment-form textarea').fill('Published from a local file.')
    await page.locator('#prose-comment-form button', { hasText: 'Add' }).first().click()
    await expect(page.locator('.prose-local-state')).toHaveText('Draft · 1 unpublished')
    expect(postedRows).toHaveLength(0)

    // Publish: pushes the draft, pulls the conversation, clears the state.
    // The remembered email rides on the reader's own draft…
    await page.locator('#prose-publish-comments').click()
    await expect(page.locator('.prose-local-state')).toHaveText('All comments published')
    expect(postedRows).toHaveLength(1)
    expect(postedRows[0].commentText).toBe('Published from a local file.')
    expect(postedRows[0].authorName).toBe('Local Lia')
    expect(postedEmails[0]).toBe('lia@example.com')
    // The thread now lives under its server id and stays tagged as ours.
    const card = page.locator('.prose-thread', { hasText: 'Published from a local file.' })
    await expect(card).toHaveAttribute('data-thread-id', /^srv-posted-/)
    await expect(card.locator('.prose-author-tag').first()).toHaveText('· you')
    // Nothing left at risk — the local footer offers no save.
    await expect(page.locator('#prose-download-copy')).toBeHidden()
    await expect(page.locator('#prose-publish-comments')).toBeHidden()
  })

  test('reloading a local copy re-shows what it published and polls in author replies', async ({ page }) => {
    await page.goto(`${origin}/s/testtoken`)
    await expect(page.locator('.prose-thread', { hasText: 'Live-only thread.' })).toBeVisible()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#prose-download-copy').click(),
    ])
    const savedPath = join(tmpDir, 'local-reload.html')
    await download.saveAs(savedPath)

    // Publish a comment from the file:// copy.
    await page.goto(pathToFileURL(savedPath).href)
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await page.locator('#prose-comment-form input').first().fill('Reload Rai')
    await page.locator('#prose-comment-form textarea').fill('Survives a reload.')
    await page.locator('#prose-comment-form button', { hasText: 'Add' }).first().click()
    await page.locator('#prose-publish-comments').click()
    await expect(page.locator('.prose-local-state')).toHaveText('All comments published')

    // Reload the SAME file: the on-disk snapshot predates the publish, but
    // the load pull recovers the published thread from the server — the
    // comment doesn't "disappear" — and re-anchors its highlight.
    await page.reload()
    const card = page.locator('.prose-thread', { hasText: 'Survives a reload.' })
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-thread-id', /^srv-posted-/)
    await expect(page.locator('article span[data-comment-id^="srv-posted-"]').first()).toBeVisible()

    // An author reply lands after the reload — the copy's poll picks it up.
    postedRows.push(
      row({ id: 'srv-auth-reply', parentId: 'srv-posted-1', commentText: 'Captured on the local copy.', authorName: 'Author', fromAuthor: true, createdAt: '2026-09-09T00:00:00.000Z' })
    )
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByText('Captured on the local copy.')).toBeVisible()
  })

  test('first post shows the one-time nudge; dismissible; never repeats', async ({ page }) => {
    await page.goto(`${origin}/s/testtoken`)
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await page.locator('#prose-comment-form input').first().fill('Nudge Nia')
    await page.locator('#prose-comment-form textarea').fill('First post here.')
    await page.locator('#prose-comment-form button', { hasText: 'Post' }).first().click()

    const nudge = page.locator('.prose-nudge')
    await expect(nudge).toContainText('Posted. Replies go to your email if you gave one.')
    await nudge.locator('.prose-nudge-dismiss').click()
    await expect(page.locator('.prose-nudge')).toHaveCount(0)

    // A second post gets no nudge.
    await page.locator('article p').nth(1).click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await page.locator('#prose-comment-form textarea').fill('Second post.')
    await page.locator('#prose-comment-form button', { hasText: 'Post' }).first().click()
    await expect(page.getByText('Second post.')).toBeVisible()
    await expect(page.locator('.prose-nudge')).toHaveCount(0)
  })

  test('the composer remembers name and email; the email is sent but never baked', async ({ page }) => {
    await page.goto(`${origin}/s/testtoken`)
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await page.locator('#prose-comment-form input').first().fill('Memo Mae')
    await page.locator('#prose-comment-form input').nth(1).fill('mae@example.com')
    await page.locator('#prose-comment-form textarea').fill('Remember me.')
    await page.locator('#prose-comment-form button', { hasText: 'Post' }).first().click()
    await expect(page.getByText('Remember me.')).toBeVisible()
    expect(postedEmails[0]).toBe('mae@example.com')

    // The next form opens prefilled from storage.
    await page.locator('article p').nth(1).click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await expect(page.locator('#prose-comment-form input').first()).toHaveValue('Memo Mae')
    await expect(page.locator('#prose-comment-form input').nth(1)).toHaveValue('mae@example.com')

    // The email lives in localStorage only — a downloaded copy of a page
    // whose threads include the posted comment must not carry it.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#prose-download-copy').click(),
    ])
    const savedPath = join(tmpDir, 'email-leak-check.html')
    await download.saveAs(savedPath)
    expect(readFileSync(savedPath, 'utf-8')).not.toContain('mae@example.com')
  })
})

test.describe('narrow mode (< 1000px)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ page }) => {
    await page.goto(artifactUrl)
  })

  test('no rail; bottom bar and text-free sup indices render instead', async ({ page }) => {
    await expect(page.locator('#prose-bottom-bar')).toBeVisible()
    await expect(page.locator('#prose-bottom-bar button')).toHaveText('Comments 2')
    expect(await page.locator('#prose-comment-rail').count()).toBe(0)
    // The top-bar count drops the word on narrow.
    await expect(page.locator('#prose-rail-toggle')).toHaveText('2')
    // Sup indices number open threads in document order. They render via CSS
    // attr(data-n) with NO text child, so article.textContent — the anchor
    // input on both the viewer and desktop sides — is unchanged.
    const sups = page.locator('article sup.prose-mark-index')
    await expect(sups).toHaveCount(2)
    await expect(sups.nth(0)).toHaveAttribute('data-n', '1')
    await expect(sups.nth(1)).toHaveAttribute('data-n', '2')
    expect(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('sup.prose-mark-index'))
          .map((s) => s.textContent)
          .join('')
      )
    ).toBe('')
  })

  test('tapping a mark opens the sheet; back returns to the text', async ({ page }) => {
    await page.locator('article span[data-comment-id="c1"]').click()
    const sheet = page.locator('#prose-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('.prose-sheet-count')).toHaveText('1 of 2')
    await expect(sheet.locator('.prose-sheet-quote')).toHaveText('"quick brown fox"')
    await expect(sheet.getByText('Nice phrase')).toBeVisible()
    await expect(sheet.getByText('Agreed — keep it.')).toBeVisible()
    await sheet.locator('.prose-sheet-back').click()
    await expect(page.locator('#prose-sheet')).toHaveCount(0)
  })

  test('sheet prev/next cycles through open threads with wraparound', async ({ page }) => {
    await page.locator('article span[data-comment-id="c1"]').click()
    const sheet = page.locator('#prose-sheet')
    await expect(sheet.locator('.prose-sheet-count')).toHaveText('1 of 2')
    await expect(sheet.locator('.prose-sheet-quote')).toHaveText('"quick brown fox"')

    await sheet.locator('.prose-sheet-step[aria-label="Next comment"]').click()
    await expect(sheet.locator('.prose-sheet-count')).toHaveText('2 of 2')
    await expect(sheet.locator('.prose-sheet-quote')).toHaveText('"notable text"')

    // Next off the end wraps to the first; prev wraps back to the last.
    await sheet.locator('.prose-sheet-step[aria-label="Next comment"]').click()
    await expect(sheet.locator('.prose-sheet-count')).toHaveText('1 of 2')
    await expect(sheet.locator('.prose-sheet-quote')).toHaveText('"quick brown fox"')
    await sheet.locator('.prose-sheet-step[aria-label="Previous comment"]').click()
    await expect(sheet.locator('.prose-sheet-count')).toHaveText('2 of 2')
  })

  test('the bottom-bar button opens the first thread; a sheet reply lands and arms the download', async ({ page }) => {
    await page.locator('#prose-bottom-bar button').click()
    const sheet = page.locator('#prose-sheet')
    await expect(sheet.locator('.prose-sheet-count')).toHaveText('1 of 2')
    await sheet.locator('.prose-sheet-composer textarea').fill('From the sheet.')
    await sheet.locator('.prose-sheet-composer input').fill('Sheet Sana')
    await sheet.locator('.prose-sheet-send').click()
    await expect(sheet.getByText('From the sheet.')).toBeVisible()
    await expect(sheet.locator('.prose-thread-reply .prose-card-name', { hasText: 'Sheet Sana' })).toBeVisible()
    // The stored name now personalizes the composer.
    await expect(sheet.locator('.prose-sheet-as')).toHaveText('Replying as Sheet Sana')
    await sheet.locator('.prose-sheet-back').click()
    await expect(page.locator('#prose-download-copy')).toContainText('(1 new)')
  })

  test('a narrow annotated copy leaks no narrow-mode DOM', async ({ page }) => {
    // Add a reply from the sheet so the copy is a real annotated one.
    await page.locator('article span[data-comment-id="c1"]').click()
    const sheet = page.locator('#prose-sheet')
    await sheet.locator('.prose-sheet-composer textarea').fill('Bake me.')
    await sheet.locator('.prose-sheet-composer input').fill('Narrow Nia')
    await sheet.locator('.prose-sheet-send').click()
    await expect(sheet.getByText('Bake me.')).toBeVisible()
    await sheet.locator('.prose-sheet-back').click()

    // Scroll fully down so the footer link clears the fixed bottom bar
    // (narrow mode pads the footer past the bar for exactly this reason).
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#prose-download-copy').click(),
    ])
    const savedPath = join(tmpDir, 'narrow-annotated.html')
    await download.saveAs(savedPath)
    const copyHtml = readFileSync(savedPath, 'utf-8')
    expect(copyHtml).not.toContain('id="prose-bottom-bar"')
    expect(copyHtml).not.toContain('id="prose-sheet"')
    expect(copyHtml).not.toContain('id="prose-narrow-form-wrap"')
    expect(copyHtml).not.toContain('prose-mark-index"')
    expect(copyHtml).not.toContain('id="prose-comment-rail"')
    const block = extractCommentsFromHtml(copyHtml)
    expect(
      block!.comments.find((c) => c.id === 'c1')!.replies!.some((r) => r.text === 'Bake me.')
    ).toBe(true)
  })
})

test.describe('share artifact opened locally', () => {
  test('file:// wins over share config: offline annotate mode, no network posts', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/comments')) requests.push(req.url())
    })
    await page.goto(shareArtifactUrl)
    await expect(page.locator('#prose-comment-rail')).toBeVisible()
    await expect(page.locator('#prose-comment-rail .prose-rail-note')).toContainText('download the annotated copy')

    // Adding a comment offline never POSTs to the embedded share endpoint.
    await page.locator('article p').first().click({ clickCount: 3 })
    await page.locator('#prose-add-comment-btn').click()
    await page.locator('#prose-comment-form input').fill('Local Lee')
    await page.locator('#prose-comment-form textarea').fill('Stays in the file.')
    await page.locator('#prose-comment-form button', { hasText: 'Add' }).first().click()
    await expect(page.getByText('Stays in the file.')).toBeVisible()
    expect(requests).toHaveLength(0)
  })
})
