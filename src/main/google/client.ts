import { Readable } from 'stream'
import { google } from 'googleapis'
import { marked } from 'marked'
import TurndownService from 'turndown'
import { getAuthenticatedClient } from './auth'

/**
 * Extract a Google Doc ID from either a raw ID or a full Google Docs URL.
 * Accepts:
 *   - Raw ID: "1BxiM0C2ABC123"
 *   - Full URL: "https://docs.google.com/document/d/1BxiM0C2ABC123/edit"
 *   - URL with query params: "https://docs.google.com/document/d/1BxiM0C2ABC123/edit?usp=sharing"
 */
export function extractDocId(input: string): string {
  const trimmed = input.trim()
  // Try to extract from Google Docs URL
  const urlMatch = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
  if (urlMatch) return urlMatch[1]
  // Otherwise treat as raw ID (alphanumeric, hyphens, underscores)
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed
  throw new Error('Invalid Google Doc ID or URL. Expected a document ID or a docs.google.com URL.')
}

export interface DocMetadata {
  id: string
  title: string
  modifiedTime: string
  webViewLink: string
}

/**
 * Convert markdown to HTML for upload to Google Docs.
 * Google Drive handles HTML-to-Docs conversion more reliably than
 * markdown-to-Docs, preserving bold, italic, strikethrough, etc.
 */
function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string
}

/**
 * Create a new Google Doc from markdown content.
 * Converts to HTML first for reliable formatting preservation.
 */
export async function createDoc(title: string, markdown: string): Promise<string> {
  const auth = await getAuthenticatedClient()
  const drive = google.drive({ version: 'v3', auth })
  const html = markdownToHtml(markdown)

  const response = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: 'application/vnd.google-apps.document'
    },
    media: {
      mimeType: 'text/html',
      body: Readable.from(html)
    },
    fields: 'id'
  })

  if (!response.data.id) {
    throw new Error('Failed to create document: no ID returned')
  }

  return response.data.id
}

/**
 * Update an existing Google Doc with new markdown content.
 * Converts to HTML first for reliable formatting preservation.
 */
export async function updateDoc(docId: string, markdown: string): Promise<void> {
  const auth = await getAuthenticatedClient()
  const drive = google.drive({ version: 'v3', auth })
  const html = markdownToHtml(markdown)

  await drive.files.update({
    fileId: docId,
    media: {
      mimeType: 'text/html',
      body: Readable.from(html)
    }
  })
}

/**
 * Get document content as markdown
 * Exports as HTML and converts to markdown to preserve formatting
 */
export async function getDoc(docId: string): Promise<string> {
  const auth = await getAuthenticatedClient()
  const drive = google.drive({ version: 'v3', auth })

  const response = await drive.files.export({
    fileId: docId,
    mimeType: 'text/html'
  }, {
    responseType: 'text'
  })

  return htmlToMarkdown(response.data as string)
}

// Configure turndown for HTML-to-markdown conversion
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  bulletListMarker: '-'
})

// Remove style and script tags (Google Docs includes lots of CSS)
turndown.addRule('removeStyles', {
  filter: ['style', 'script', 'head'],
  replacement: () => ''
})

// Add strikethrough support (not built-in)
turndown.addRule('strikethrough', {
  filter: ['del', 's', 'strike'],
  replacement: (content) => `~~${content}~~`
})

// Add underline support (non-standard markdown, use underscore emphasis)
turndown.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `_${content}_`
})

// Helper to get raw style attribute string from a node
function getStyleAttr(node: Node): string {
  return (node as Element).getAttribute?.('style') || ''
}

// Helper to unwrap Google redirect URLs (google.com/url?q=ACTUAL_URL&...)
function unwrapGoogleUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'www.google.com' && parsed.pathname === '/url') {
      const actualUrl = parsed.searchParams.get('q')
      if (actualUrl) return actualUrl
    }
  } catch {
    // Not a valid URL, return as-is
  }
  return url
}

// Handle Google Docs links - unwrap redirect URLs
turndown.addRule('googleDocsLinks', {
  filter: 'a',
  replacement: (content, node) => {
    const href = (node as Element).getAttribute?.('href') || ''
    const url = unwrapGoogleUrl(href)
    const text = content.trim()
    if (!text || text === url) return url
    return `[${text}](${url})`
  }
})

// Google Docs uses spans with inline styles instead of semantic tags
// Parse the raw style attribute since Node.js doesn't compute CSS properties

// Handle bold spans (font-weight: 700 or bold)
turndown.addRule('googleDocsBold', {
  filter: (node) => {
    if (node.nodeName !== 'SPAN') return false
    const style = getStyleAttr(node)
    return /font-weight:\s*(700|bold)/i.test(style)
  },
  replacement: (content) => content.trim() ? `**${content}**` : ''
})

// Handle italic spans (font-style: italic)
turndown.addRule('googleDocsItalic', {
  filter: (node) => {
    if (node.nodeName !== 'SPAN') return false
    const style = getStyleAttr(node)
    return /font-style:\s*italic/i.test(style)
  },
  replacement: (content) => content.trim() ? `*${content}*` : ''
})

// Handle strikethrough spans (text-decoration includes line-through)
turndown.addRule('googleDocsStrikethrough', {
  filter: (node) => {
    if (node.nodeName !== 'SPAN') return false
    const style = getStyleAttr(node)
    return /text-decoration[^:]*:[^;]*line-through/i.test(style)
  },
  replacement: (content) => content.trim() ? `~~${content}~~` : ''
})

// Handle underline spans (text-decoration includes underline)
turndown.addRule('googleDocsUnderline', {
  filter: (node) => {
    if (node.nodeName !== 'SPAN') return false
    const style = getStyleAttr(node)
    return /text-decoration[^:]*:[^;]*underline/i.test(style)
  },
  replacement: (content) => content.trim() ? `_${content}_` : ''
})

// Handle code spans (monospace font families)
turndown.addRule('googleDocsCode', {
  filter: (node) => {
    if (node.nodeName !== 'SPAN') return false
    const style = getStyleAttr(node).toLowerCase()
    return /font-family:[^;]*(monospace|courier|consolas|menlo|monaco|roboto\s*mono|fira\s*code|source\s*code|jetbrains|inconsolata)/i.test(style)
  },
  replacement: (content) => content.trim() ? `\`${content}\`` : ''
})

// Handle Google Docs "blockquotes" (indented paragraphs via margin-left)
// Google Docs doesn't use semantic <blockquote> tags - it uses inline styles
turndown.addRule('googleDocsBlockquote', {
  filter: (node) => {
    if (node.nodeName !== 'P') return false
    const style = getStyleAttr(node)
    // Google Docs uses margin-left for indentation (typically 36pt or 40px+ for quotes)
    const marginMatch = style.match(/margin-left:\s*(\d+(?:\.\d+)?)(pt|px)?/)
    if (marginMatch) {
      const value = parseFloat(marginMatch[1])
      const unit = marginMatch[2] || 'pt'
      // Convert to pixels for comparison (1pt ≈ 1.33px)
      const marginPx = unit === 'pt' ? value * 1.33 : value
      return marginPx >= 30 // Threshold for "quote-like" indentation
    }
    return false
  },
  replacement: (content) => {
    const text = content.trim()
    if (!text) return ''
    // Prefix each line with >
    return '\n\n' + text.split('\n').map(line => `> ${line}`).join('\n') + '\n\n'
  }
})

// Debug flag for diagnosing Google Docs HTML structure
const DEBUG_GOOGLE_DOCS_HTML = process.env.DEBUG_GOOGLE_DOCS_HTML === 'true'

/**
 * Convert HTML from Google Docs export to markdown
 */
function htmlToMarkdown(html: string): string {
  // Debug: log list HTML structure to help diagnose nested list issues
  if (DEBUG_GOOGLE_DOCS_HTML) {
    const listPattern = /<(ul|ol)[^>]*>[\s\S]*?<\/\1>/gi
    const lists = html.match(listPattern)
    if (lists) {
      console.log('[GoogleDocs] Found lists in HTML:')
      lists.forEach((list, i) => {
        console.log(`[GoogleDocs] List ${i + 1}:`, list.substring(0, 500))
      })
    }
  }
  return turndown.turndown(html)
}

/**
 * Get document metadata
 */
export async function getDocMetadata(docId: string): Promise<DocMetadata> {
  const auth = await getAuthenticatedClient()
  const drive = google.drive({ version: 'v3', auth })

  const response = await drive.files.get({
    fileId: docId,
    fields: 'id,name,modifiedTime,webViewLink'
  })

  if (!response.data.id) {
    throw new Error('Document not found')
  }

  return {
    id: response.data.id,
    title: response.data.name || 'Untitled',
    modifiedTime: response.data.modifiedTime || new Date().toISOString(),
    webViewLink: response.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`
  }
}

/**
 * Check if a document exists and is accessible
 */
export async function docExists(docId: string): Promise<boolean> {
  try {
    await getDocMetadata(docId)
    return true
  } catch {
    return false
  }
}

/**
 * List recent documents created by this app
 */
export async function listRecentDocs(maxResults: number = 10): Promise<DocMetadata[]> {
  const auth = await getAuthenticatedClient()
  const drive = google.drive({ version: 'v3', auth })

  const response = await drive.files.list({
    pageSize: maxResults,
    fields: 'files(id,name,modifiedTime,webViewLink)',
    orderBy: 'modifiedTime desc',
    q: "mimeType='application/vnd.google-apps.document'"
  })

  return (response.data.files || []).map(file => ({
    id: file.id || '',
    title: file.name || 'Untitled',
    modifiedTime: file.modifiedTime || new Date().toISOString(),
    webViewLink: file.webViewLink || ''
  }))
}
