import { serializeMarkdown } from './markdown'
import type { CommentData } from '../extensions/comments/types'
import { ARTIFACT_BASE_STYLES, THEME_INIT_SCRIPT, VIEWER_SCRIPT, VIEWER_STYLES } from './viewerScript'

const PROSE_MARKER = 'application/x-prose-markdown'
const PROSE_COMMENTS_MARKER = 'application/x-prose-comments'
const PROSE_SHARE_MARKER = 'application/x-prose-share'

const MAX_COMMENT_LENGTH = 5000
const MAX_MARKED_TEXT_LENGTH = 5000
const MAX_NAME_LENGTH = 100

/** Shape of the embedded comments block (#768). Version bumps on breaking changes. */
export interface EmbeddedCommentsBlock {
  version: 1
  /** Content-derived artifact revision (first 16 hex of SHA-256) — see computePublishRev. */
  publishRev: string
  /** ISO timestamp of when the artifact was built. */
  publishedAt: string
  comments: CommentData[]
}

/** Shape of the embedded share-config block (#768). Published artifacts only —
 * never local exports. NO token in the PUBLISHED artifact: the viewer reads it
 * from window.location, so a gateway/R2 dump never exposes live links.
 * `shareUrl` (the full capability URL) appears ONLY in annotated copies the
 * viewer downloads from the served page — the downloader already holds that
 * URL — and lets a local file:// copy publish its comments back. */
export interface ShareConfig {
  shareEndpoint: string
  publishRev: string
  publishedAt: string
  shareUrl?: string
}

/**
 * Stylesheet for plain (viewer-free) exports — byte-identical to the pre-#769
 * sheet. Viewer-carrying artifacts use ARTIFACT_BASE_STYLES + VIEWER_STYLES
 * (the themed "two materials" design) instead.
 */
const PLAIN_EXPORT_STYLES = `
    body {
      max-width: 42rem;
      margin: 2rem auto;
      padding: 0 1rem;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #e0e0e0; }
      a { color: #6ea8fe; }
    }
    pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
    @media (prefers-color-scheme: dark) { pre { background: #2a2a2a; } }
    code { font-size: 0.9em; }
    blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1rem; color: #666; }
    img { max-width: 100%; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
    ul[data-type="taskList"] { list-style: none; padding-left: 0; }
    ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5rem; }
    ul[data-type="taskList"] li label { flex-shrink: 0; margin-top: 0.2rem; }
    ul[data-type="taskList"] li div, ul[data-type="taskList"] li p { margin: 0; }`

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
}

/**
 * Read a local image file and return its data URI, or null on failure.
 */
async function readImageAsDataUri(filePath: string): Promise<string | null> {
  if (typeof window === 'undefined' || !window.api?.readFileBase64) return null
  const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
  const mime = MIME_TYPES[ext] || 'image/png'
  try {
    const base64 = await window.api.readFileBase64(filePath)
    return `data:${mime};base64,${base64}`
  } catch {
    return null
  }
}

/**
 * Build a map of local file paths to data URIs for all local images.
 * Used to inline images in both the visible HTML and the embedded markdown.
 */
async function buildImageMap(html: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()

  // From HTML: local-file:// URLs
  const htmlMatches = [...html.matchAll(/src="local-file:\/\/([^"]+)"/g)]
  for (const match of htmlMatches) {
    const filePath = match[1]
    if (map.has(filePath)) continue
    const dataUri = await readImageAsDataUri(filePath)
    if (dataUri) map.set(filePath, dataUri)
  }

  return map
}

/**
 * Replace local-file:// URLs in HTML with data URIs.
 */
function inlineHtmlImages(html: string, imageMap: Map<string, string>): string {
  return html.replace(/src="local-file:\/\/([^"]+)"/g, (match, filePath) => {
    const dataUri = imageMap.get(filePath)
    return dataUri ? `src="${dataUri}"` : match
  })
}

/**
 * Replace relative image paths in markdown with data URIs.
 * Handles ![alt](relative-path.png) patterns.
 */
function inlineMarkdownImages(markdown: string, imageMap: Map<string, string>, docDir: string | null): string {
  if (!docDir) return markdown
  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    if (/^(https?:|data:)/i.test(src)) return match
    const fullPath = `${docDir}/${src}`
    const dataUri = imageMap.get(fullPath)
    return dataUri ? `![${alt}](${dataUri})` : match
  })
}

function encodeBase64Utf8(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
}

function decodeBase64Utf8(value: string): string {
  return decodeURIComponent(escape(atob(value)))
}

/** C0/C1 control chars except \t (0x09) and \n (0x0A) — stripped from embedded comment fields. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/**
 * Cap length and strip control characters from a comment field before
 * embedding. Deliberately NOT entity-escaped: script-context safety comes from
 * base64-encoding the whole block (no literal `</script>` can appear), and DOM
 * safety from the viewer rendering exclusively via textContent — escaping here
 * would corrupt legitimate text like `1 < 2` at display time.
 */
function sanitizeField(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(CONTROL_CHARS, '').substring(0, maxLength)
}

function sanitizeComments(comments: CommentData[]): CommentData[] {
  return comments.map(({ shareId, ...c }) => ({
    ...c,
    // Dedupe invariant (#769), thread level: a thread that was pushed to the
    // gateway bakes under its server row id (shareId), so the baked copy and
    // the live-poll row share one id and the viewer merge can't double it.
    // Like reply shareIds, the field itself is local bookkeeping — never
    // embedded (pulled threads already have id === shareId, unchanged).
    id: shareId ?? c.id,
    markedText: sanitizeField(c.markedText, MAX_MARKED_TEXT_LENGTH),
    comment: sanitizeField(c.comment, MAX_COMMENT_LENGTH),
    replies: (c.replies ?? []).map((r) => {
      // Dedupe invariant (#769): a reply that was pushed to the gateway bakes
      // under its server row id (shareId), so the baked copy and the live-poll
      // row share one id and the viewer merge can't double it. shareId itself
      // is local bookkeeping and never embedded.
      const { shareId, ...rest } = r
      return {
        ...rest,
        id: shareId ?? r.id,
        text: sanitizeField(r.text, MAX_COMMENT_LENGTH),
        ...(r.authorName !== undefined ? { authorName: sanitizeField(r.authorName, MAX_NAME_LENGTH) } : {}),
      }
    }),
  }))
}

/**
 * Content-derived artifact revision: first 16 hex chars of SHA-256 over the
 * rendered HTML + embedded markdown. Identical content → identical rev, so
 * re-publishing an unchanged document is idempotent. Comments are NOT part of
 * the hash — the rev identifies the content snapshot an anchor was computed
 * against (#768/#769).
 */
async function computePublishRev(inlinedHtml: string, encodedMarkdown: string): Promise<string> {
  const data = new TextEncoder().encode(`${inlinedHtml}\n${encodedMarkdown}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 16)
}

/** JSON.stringify with `<` escaped so the output can never contain `</script>`. */
function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** Theme-toggle glyphs (from the Share Viewer design): sun shows in dark, moon in light. */
const SUN_SVG =
  '<svg class="prose-icon-sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line><line x1="2" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"></line><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"></line><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"></line><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"></line></svg>'
const MOON_SVG =
  '<svg class="prose-icon-moon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'

/**
 * Build a standalone HTML document from editor HTML + original markdown.
 * The markdown is base64-encoded in a <script> tag so Prose can recover it
 * on re-open — the rendered HTML is just for viewing outside Prose.
 * Images are inlined as base64 data URIs for portability.
 *
 * When `comments` are provided (#768), the full thread data is embedded in a
 * second base64 <script> block and the inline comment viewer (highlight styles
 * + comment rail) ships inside the file — comments travel with the document,
 * including when the file is opened from file://.
 *
 * `shareEndpoint` is set only by buildShareHtml (published artifacts): it adds
 * the share-config block that switches the viewer into commenting mode when
 * the artifact is served from a share link.
 */
async function buildArtifactHtml(
  editorHtml: string,
  markdown: string,
  frontmatter: Record<string, unknown>,
  title: string,
  documentDir: string | null,
  comments: CommentData[] | undefined,
  shareEndpoint: string | null
): Promise<string> {
  const imageMap = await buildImageMap(editorHtml)
  const inlinedHtml = inlineHtmlImages(editorHtml, imageMap)
  const inlinedMarkdown = inlineMarkdownImages(
    serializeMarkdown(markdown, frontmatter),
    imageMap,
    documentDir
  )
  const encoded = encodeBase64Utf8(inlinedMarkdown)

  // Passing a comments array (even an empty one) marks the export as an
  // annotatable artifact: the blocks + inline viewer are embedded so anyone
  // can comment into the file offline and download an annotated copy (#768
  // tier 3). Omitting the argument entirely produces the plain viewer-free
  // export (no current caller does).
  const withViewer = comments !== undefined || shareEndpoint !== null
  const publishedAt = new Date().toISOString()
  const publishRev = withViewer ? await computePublishRev(inlinedHtml, encoded) : null

  // Baked page shell (viewer artifacts only) — the "two materials" chrome.
  // INVARIANT (anchor purity): every chrome text node lives OUTSIDE <article>.
  // Both the viewer's computeAnchor and the desktop's restoreComments
  // normalize article text; chrome inside <article> would silently shift
  // every occurrence index. <article> wraps exactly the editor HTML.
  let bodyContent: string
  if (withViewer) {
    const eyebrow = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
      new Date(publishedAt)
    )
    const openCount = (comments ?? []).filter((c) => !c.resolved).length
    // Docs that open with their own H1 keep it as the display title inside
    // <article>; otherwise the derived title is baked into the header.
    const hasLeadingH1 = /^\s*<h1[\s>]/.test(inlinedHtml)
    bodyContent = `  <div class="prose-page">
    <div class="prose-topbar">
      <span class="prose-wordmark"><span class="prose-pilcrow">¶</span><span>Prose.</span></span>
      <div class="prose-topbar-tools">
        <button id="prose-rail-toggle" type="button" aria-label="Toggle comments"><span class="prose-comment-dot"></span><span id="prose-rail-count">${openCount} comments</span></button>
        <span class="prose-topbar-divider"></span>
        <button id="prose-theme-toggle" type="button" aria-label="Toggle appearance">${SUN_SVG}${MOON_SVG}</button>
      </div>
    </div>
    <header class="prose-doc-header">
      <div class="prose-doc-eyebrow">${escapeHtml(eyebrow)}</div>${hasLeadingH1 ? '' : `\n      <h1 class="prose-doc-title">${escapeHtml(title)}</h1>`}
    </header>
    <article>
${inlinedHtml}
    </article>
    <div class="prose-end-mark">— End</div>
    <footer class="prose-artifact-footer">
      <span>Shared with Prose. Comments travel inside this file.</span>
      <a id="prose-download-copy" href="#">Download annotated copy</a>
    </footer>
  </div>`
  } else {
    bodyContent = `  <article>
${inlinedHtml}
  </article>`
  }

  let embeddedBlocks = ''
  if (withViewer && publishRev) {
    const commentsBlock: EmbeddedCommentsBlock = {
      version: 1,
      publishRev,
      publishedAt,
      comments: sanitizeComments(comments ?? []),
    }
    embeddedBlocks += `\n  <script type="${PROSE_COMMENTS_MARKER}" data-version="1" data-encoding="base64">${encodeBase64Utf8(JSON.stringify(commentsBlock))}</script>`
    if (shareEndpoint !== null) {
      const shareConfig: ShareConfig = { shareEndpoint, publishRev, publishedAt }
      embeddedBlocks += `\n  <script type="${PROSE_SHARE_MARKER}" data-version="1">${jsonForInlineScript(shareConfig)}</script>`
    }
    embeddedBlocks += `\n  <script>/* prose-viewer v1 */\n${VIEWER_SCRIPT}</script>`
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="Prose">${shareEndpoint !== null ? '\n  <meta name="referrer" content="no-referrer">' : ''}
  <title>${escapeHtml(title)}</title>${
    withViewer
      ? `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,700&family=IBM+Plex+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&display=swap">
  <script>/* prose-theme */\n${THEME_INIT_SCRIPT}</script>`
      : ''
  }
  <style>${withViewer ? `${ARTIFACT_BASE_STYLES}${VIEWER_STYLES}` : PLAIN_EXPORT_STYLES}
  </style>
</head>
<body>
${bodyContent}
  <script type="${PROSE_MARKER}" data-encoding="base64">${encoded}</script>${embeddedBlocks}
</body>
</html>`
}

/**
 * Build a standalone HTML export. When `comments` are provided, the thread
 * data + inline viewer are embedded so comments travel with the file (#768).
 * Behavior with no comments is byte-identical to the pre-#768 export.
 */
export async function buildProseHtml(
  editorHtml: string,
  markdown: string,
  frontmatter: Record<string, unknown>,
  title: string,
  documentDir: string | null,
  comments?: CommentData[]
): Promise<string> {
  return buildArtifactHtml(editorHtml, markdown, frontmatter, title, documentDir, comments, null)
}

/**
 * Build a share artifact for publishing to the gateway (#768): the standard
 * export + embedded comments + the share-config block that switches the
 * embedded viewer into commenting mode when served from /s/<token>.
 * The capability token is never embedded — the viewer reads it from the URL.
 */
export async function buildShareHtml(
  editorHtml: string,
  markdown: string,
  frontmatter: Record<string, unknown>,
  title: string,
  documentDir: string | null,
  comments: CommentData[],
  shareEndpoint: string
): Promise<string> {
  return buildArtifactHtml(editorHtml, markdown, frontmatter, title, documentDir, comments, shareEndpoint)
}

/**
 * Check if an HTML string is a Prose-exported file with embedded markdown.
 */
export function isProseHtml(html: string): boolean {
  return html.includes(`type="${PROSE_MARKER}"`)
}

/**
 * Extract the original markdown from a Prose-exported HTML file.
 * Returns null if the file doesn't contain embedded markdown.
 */
export function extractMarkdownFromHtml(html: string): string | null {
  const regex = new RegExp(
    `<script\\s+type="${PROSE_MARKER}"\\s+data-encoding="base64"\\s*>([^<]+)</script>`
  )
  const match = html.match(regex)
  if (!match) return null

  try {
    return decodeBase64Utf8(match[1].trim())
  } catch {
    return null
  }
}

/**
 * Extract the embedded comment threads from a Prose artifact (#768).
 * Returns null if the file has no comments block or it is malformed.
 */
export function extractCommentsFromHtml(html: string): EmbeddedCommentsBlock | null {
  const regex = new RegExp(
    `<script\\s+type="${PROSE_COMMENTS_MARKER}"\\s+data-version="1"\\s+data-encoding="base64"\\s*>([^<]+)</script>`
  )
  const match = html.match(regex)
  if (!match) return null

  try {
    const parsed = JSON.parse(decodeBase64Utf8(match[1].trim())) as EmbeddedCommentsBlock
    if (parsed?.version !== 1 || !Array.isArray(parsed.comments)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Extract the share config from a published Prose artifact (#768).
 * Returns null for local exports (no share block) or malformed blocks.
 */
export function extractShareConfigFromHtml(html: string): ShareConfig | null {
  // The [^<]+ capture is coupled to the write path: buildArtifactHtml MUST
  // serialize this block with jsonForInlineScript (which escapes `<` to
  // \u003c) or extraction silently fails. Keep the two in step.
  const regex = new RegExp(
    `<script\\s+type="${PROSE_SHARE_MARKER}"\\s+data-version="1"\\s*>([^<]+)</script>`
  )
  const match = html.match(regex)
  if (!match) return null

  try {
    const parsed = JSON.parse(match[1].trim()) as ShareConfig
    if (typeof parsed?.shareEndpoint !== 'string' || typeof parsed?.publishRev !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
