import { serializeMarkdown } from './markdown'
import type { CommentData } from '../extensions/comments/types'
import { VIEWER_SCRIPT, VIEWER_STYLES } from './viewerScript'

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

/** Shape of the embedded share-config block (#768). Published artifacts only — never local exports. NO token: the viewer reads it from window.location. */
export interface ShareConfig {
  shareEndpoint: string
  publishRev: string
  publishedAt: string
}

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
  return comments.map((c) => ({
    ...c,
    markedText: sanitizeField(c.markedText, MAX_MARKED_TEXT_LENGTH),
    comment: sanitizeField(c.comment, MAX_COMMENT_LENGTH),
    replies: (c.replies ?? []).map((r) => ({
      ...r,
      text: sanitizeField(r.text, MAX_COMMENT_LENGTH),
      ...(r.authorName !== undefined ? { authorName: sanitizeField(r.authorName, MAX_NAME_LENGTH) } : {}),
    })),
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

  const hasComments = !!comments && comments.length > 0
  const withViewer = hasComments || shareEndpoint !== null
  const publishedAt = new Date().toISOString()
  const publishRev = withViewer ? await computePublishRev(inlinedHtml, encoded) : null

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
  <title>${escapeHtml(title)}</title>
  <style>
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
    ul[data-type="taskList"] li div, ul[data-type="taskList"] li p { margin: 0; }${withViewer ? VIEWER_STYLES : ''}
  </style>
</head>
<body>
  <article>
${inlinedHtml}
  </article>
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
