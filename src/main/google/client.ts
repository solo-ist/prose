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
 * Represents a parsed list item with its indentation level
 */
interface ListItem {
  content: string
  marginLeft: number
  fullMatch: string
}

/**
 * Extract margin-left value from an HTML element string.
 * Google Docs may put margin-left on the <li> tag or on child elements like <p> or <span>.
 */
function extractMarginLeft(html: string): number {
  // Look for margin-left in any style attribute within this HTML
  const marginPattern = /margin-left:\s*(\d+(?:\.\d+)?)(pt|px)?/gi
  let maxMargin = 0

  let match
  while ((match = marginPattern.exec(html)) !== null) {
    const value = parseFloat(match[1])
    const unit = match[2] || 'pt'
    // Convert to pixels for consistent comparison (1pt ≈ 1.33px)
    const marginPx = unit === 'pt' ? value * 1.33 : value
    // Use the largest margin found (in case there are multiple)
    if (marginPx > maxMargin) {
      maxMargin = marginPx
    }
  }

  return maxMargin
}

/**
 * Parse list items from a <ul> or <ol> content, extracting margin-left values.
 * Google Docs exports flat lists with margin-left styles instead of semantic nesting.
 */
function parseListItems(html: string): ListItem[] {
  const items: ListItem[] = []

  // Match <li> elements - use a more robust pattern that handles nested tags
  // We need to be careful with nested tags, so we match opening <li> and find the closing </li>
  const liOpenPattern = /<li[^>]*>/gi
  let openMatch

  while ((openMatch = liOpenPattern.exec(html)) !== null) {
    const startIndex = openMatch.index
    const afterOpenTag = openMatch.index + openMatch[0].length

    // Find the closing </li> - need to handle nested elements
    let depth = 1
    let endIndex = afterOpenTag

    while (depth > 0 && endIndex < html.length) {
      const nextOpen = html.indexOf('<li', endIndex)
      const nextClose = html.indexOf('</li>', endIndex)

      if (nextClose === -1) break

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++
        endIndex = nextOpen + 3
      } else {
        depth--
        if (depth === 0) {
          endIndex = nextClose
        } else {
          endIndex = nextClose + 5
        }
      }
    }

    const fullMatch = html.substring(startIndex, endIndex + 5)
    const content = html.substring(afterOpenTag, endIndex)
    const marginLeft = extractMarginLeft(fullMatch)

    items.push({ content, marginLeft, fullMatch })
  }

  return items
}

/**
 * Build nested list HTML from flat items based on their indentation levels.
 * Groups consecutive items by relative indentation to create proper <ul>/<ol> nesting.
 */
function buildNestedList(items: ListItem[], listTag: string): string {
  if (items.length === 0) return ''

  // Determine indentation levels by finding unique margin values
  // Round to nearest 10px to group similar margins together
  const roundedMargins = items.map(i => Math.round(i.marginLeft / 20) * 20)
  const uniqueMargins = [...new Set(roundedMargins)].sort((a, b) => a - b)

  // Map each rounded margin value to a level (0, 1, 2, etc.)
  const marginToLevel = new Map<number, number>()
  uniqueMargins.forEach((m, i) => marginToLevel.set(m, i))

  function getLevel(margin: number): number {
    const rounded = Math.round(margin / 20) * 20
    return marginToLevel.get(rounded) || 0
  }

  // Build the nested structure recursively
  let i = 0

  function buildLevel(currentLevel: number): string {
    let html = ''

    while (i < items.length) {
      const item = items[i]
      const itemLevel = getLevel(item.marginLeft)

      if (itemLevel < currentLevel) {
        // This item belongs to a parent level, return to parent
        break
      }

      if (itemLevel > currentLevel) {
        // This item is nested deeper - create nested list
        html += `<${listTag}>${buildLevel(itemLevel)}</${listTag}>`
      } else {
        // Same level - add the item
        html += `<li>${item.content}</li>`
        i++

        // Check if next items are nested under this one
        if (i < items.length && getLevel(items[i].marginLeft) > currentLevel) {
          // Remove the closing </li> and append nested list inside
          html = html.slice(0, -5) // Remove "</li>"
          html += `<${listTag}>${buildLevel(currentLevel + 1)}</${listTag}></li>`
        }
      }
    }

    return html
  }

  return buildLevel(0)
}

/**
 * Pre-process Google Docs HTML to reconstruct nested lists.
 * Google Docs exports flat lists with margin-left styles instead of nested <ul>/<ol>.
 * This function rebuilds proper semantic nesting based on indentation levels.
 */
function reconstructNestedLists(html: string): string {
  // Match <ul> and <ol> blocks (non-greedy to handle multiple lists)
  return html.replace(/<(ul|ol)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => {
    const items = parseListItems(content)

    if (DEBUG_GOOGLE_DOCS_HTML) {
      console.log('[GoogleDocs] Parsing list items:')
      items.forEach((item, idx) => {
        console.log(`  [${idx}] margin: ${item.marginLeft.toFixed(1)}px, content: ${item.content.substring(0, 80)}...`)
      })
    }

    // If no items found or all items have same margin, no nesting needed
    if (items.length === 0) return match

    const uniqueMargins = new Set(items.map(i => Math.round(i.marginLeft / 20) * 20))
    if (uniqueMargins.size <= 1) {
      return match // Return original, no reconstruction needed
    }

    const nested = buildNestedList(items, tag)

    if (DEBUG_GOOGLE_DOCS_HTML) {
      console.log('[GoogleDocs] Reconstructed nested list:', `<${tag}${attrs}>${nested}</${tag}>`.substring(0, 300))
    }

    return `<${tag}${attrs}>${nested}</${tag}>`
  })
}

/**
 * Convert HTML from Google Docs export to markdown
 */
function htmlToMarkdown(html: string): string {
  // Debug: log list HTML structure to help diagnose nested list issues
  if (DEBUG_GOOGLE_DOCS_HTML) {
    const listPattern = /<(ul|ol)[^>]*>[\s\S]*?<\/\1>/gi
    const lists = html.match(listPattern)
    if (lists) {
      console.log('[GoogleDocs] Found lists in HTML (before preprocessing):')
      lists.forEach((list, i) => {
        console.log(`[GoogleDocs] List ${i + 1}:`, list.substring(0, 500))
      })
    }
  }

  // Reconstruct nested lists from Google Docs' flat structure
  const preprocessed = reconstructNestedLists(html)

  return turndown.turndown(preprocessed)
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
