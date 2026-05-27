import { serializeMarkdown } from './markdown'

const PROSE_MARKER = 'application/x-prose-markdown'

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
  if (!window.api?.readFileBase64) return null
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

/**
 * Build a standalone HTML document from editor HTML + original markdown.
 * The markdown is base64-encoded in a <script> tag so Prose can recover it
 * on re-open — the rendered HTML is just for viewing outside Prose.
 * Images are inlined as base64 data URIs for portability.
 */
export async function buildProseHtml(
  editorHtml: string,
  markdown: string,
  frontmatter: Record<string, unknown>,
  title: string,
  documentDir: string | null
): Promise<string> {
  const imageMap = await buildImageMap(editorHtml)
  const inlinedHtml = inlineHtmlImages(editorHtml, imageMap)
  const inlinedMarkdown = inlineMarkdownImages(
    serializeMarkdown(markdown, frontmatter),
    imageMap,
    documentDir
  )
  const encoded = btoa(unescape(encodeURIComponent(inlinedMarkdown)))

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="Prose">
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
    ul[data-type="taskList"] li div, ul[data-type="taskList"] li p { margin: 0; }
  </style>
</head>
<body>
  <article>
${inlinedHtml}
  </article>
  <script type="${PROSE_MARKER}" data-encoding="base64">${encoded}</script>
</body>
</html>`
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
    return decodeURIComponent(escape(atob(match[1].trim())))
  } catch {
    return null
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
