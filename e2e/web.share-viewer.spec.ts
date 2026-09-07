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
    await expect(rail.locator('.prose-resolved-section .prose-thread-quote')).toHaveText('"lazy dog"')
    await expect(rail.getByText('This thread was resolved.')).toBeVisible()
  })

  test('rail cards stack aligned to their marks without overlap', async ({ page }) => {
    const c1 = page.locator('.prose-thread[data-thread-id="c1"]')
    const c2 = page.locator('.prose-thread[data-thread-id="c2"]')
    await expect(c1).toBeVisible()
    await expect(c2).toBeVisible()
    const top1 = await c1.evaluate((node) => parseFloat((node as HTMLElement).style.top))
    const top2 = await c2.evaluate((node) => parseFloat((node as HTMLElement).style.top))
    const h1 = await c1.evaluate((node) => (node as HTMLElement).offsetHeight)
    expect(top1).toBeGreaterThan(0)
    // No overlap: the later card sits below the earlier one plus the gap.
    expect(top2).toBeGreaterThanOrEqual(top1 + h1 + 10)
    // The first card aligns to its highlight (markTop - 6) when unobstructed.
    const markTop = await page.evaluate(() => {
      const root = document.querySelector('.prose-page')!.getBoundingClientRect().top
      const mark = document.querySelector('article span[data-comment-id="c1"]')!
      return mark.getBoundingClientRect().top - root
    })
    expect(Math.abs(top1 - (markTop - 6))).toBeLessThan(1.5)
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
    await expect(page.locator('#prose-download-copy')).toContainText('annotated copy (1 new)')
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

  test('download without additions produces a clean copy', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#prose-download-copy').click(),
    ])
    const savedPath = join(tmpDir, 'clean-copy.html')
    await download.saveAs(savedPath)
    const copyHtml = readFileSync(savedPath, 'utf-8')
    expect(extractCommentsFromHtml(copyHtml)!.comments).toHaveLength(3)
    // Runtime viewer DOM is stripped; baked chrome (top bar, footer) stays.
    expect(copyHtml).not.toContain('id="prose-comment-rail"')
    expect(copyHtml).toContain('id="prose-rail-toggle"')
    expect(copyHtml).toContain('id="prose-download-copy"')
    // The downloading viewer's theme preference must not be baked into the
    // copy — its next reader re-derives theme from their own storage/OS.
    expect(copyHtml).not.toMatch(/<html[^>]*class="[^"]*dark/)
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
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self'"

  let server: import('node:http').Server
  let origin: string
  let commentRows: Array<Record<string, unknown>> = []
  let postedRows: Array<Record<string, unknown>> = []

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
    server = createServer((req, res) => {
      const url = req.url ?? ''
      if (req.method === 'GET' && url === '/s/testtoken') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP })
        res.end(artifactHtmlOnline)
      } else if (req.method === 'GET' && url.startsWith('/s/testtoken/comments')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ comments: [...commentRows, ...postedRows], nextCursor: null }))
      } else if (req.method === 'POST' && url === '/s/testtoken/comments') {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          const parsed = JSON.parse(body) as { commentText: string; markedText: string; occurrenceIndex: number; authorName: string }
          postedRows.push(row({
            id: 'srv-posted-1',
            markedText: parsed.markedText,
            occurrenceIndex: parsed.occurrenceIndex,
            commentText: parsed.commentText,
            authorName: parsed.authorName,
            createdAt: '2026-09-07T00:05:00.000Z',
          }))
          res.writeHead(201, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ id: 'srv-posted-1', createdAt: '2026-09-07T00:05:00.000Z' }))
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
