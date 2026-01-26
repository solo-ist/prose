import { google, docs_v1 } from 'googleapis'
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
 * Create a new Google Doc from markdown content
 * Creates an empty doc first, then inserts content via Docs API
 * (avoids googleapis media upload which requires Buffer/Node streams)
 */
export async function createDoc(title: string, markdown: string): Promise<string> {
  const auth = await getAuthenticatedClient()
  const drive = google.drive({ version: 'v3', auth })

  // Create an empty Google Doc
  const response = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: 'application/vnd.google-apps.document'
    },
    fields: 'id'
  })

  if (!response.data.id) {
    throw new Error('Failed to create document: no ID returned')
  }

  // Insert content using the Docs API (no Buffer dependency)
  if (markdown.length > 0) {
    await updateDoc(response.data.id, markdown)
  }

  return response.data.id
}

/**
 * Update an existing Google Doc with new markdown content
 * This replaces the entire document content
 */
export async function updateDoc(docId: string, markdown: string): Promise<void> {
  const auth = await getAuthenticatedClient()
  const docs = google.docs({ version: 'v1', auth })

  // First, get the current document to find its content length
  const doc = await docs.documents.get({ documentId: docId })
  const content = doc.data.body?.content || []

  // Calculate the end index (excluding the final newline that Google Docs adds)
  let endIndex = 1
  for (const element of content) {
    if (element.endIndex && element.endIndex > endIndex) {
      endIndex = element.endIndex
    }
  }

  // Build batch update requests
  const requests: docs_v1.Schema$Request[] = []

  // Delete all existing content (if any beyond the trailing newline)
  if (endIndex > 2) {
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: 1,
          endIndex: endIndex - 1
        }
      }
    })
  }

  // Insert new content
  // Note: We insert plain text here. For proper markdown rendering,
  // users should use the native Google Docs import feature.
  if (markdown.length > 0) {
    requests.push({
      insertText: {
        location: { index: 1 },
        text: markdown
      }
    })
  }

  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests }
    })
  }
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

/**
 * Convert HTML from Google Docs export to markdown
 */
function htmlToMarkdown(html: string): string {
  // Strip the full HTML wrapper - get just the body content
  let body = html
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
  if (bodyMatch) {
    body = bodyMatch[1]
  }

  let md = body

  // Remove Google Docs style tags and spans with inline styles
  md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

  // Headings (Google Docs uses h1-h6)
  for (let i = 1; i <= 6; i++) {
    const hashes = '#'.repeat(i)
    const re = new RegExp(`<h${i}[^>]*>(.*?)<\\/h${i}>`, 'gi')
    md = md.replace(re, (_match, content) => `${hashes} ${stripTags(content).trim()}\n\n`)
  }

  // Bold
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')

  // Italic
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')

  // Underline (no native markdown, use emphasis)
  md = md.replace(/<u[^>]*>(.*?)<\/u>/gi, '_$1_')

  // Strikethrough
  md = md.replace(/<s[^>]*>(.*?)<\/s>/gi, '~~$1~~')
  md = md.replace(/<strike[^>]*>(.*?)<\/strike>/gi, '~~$1~~')
  md = md.replace(/<del[^>]*>(.*?)<\/del>/gi, '~~$1~~')

  // Code (inline)
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')

  // Pre/code blocks
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, content) => {
    return '\n```\n' + stripTags(content).trim() + '\n```\n\n'
  })

  // Links
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_match, href, text) => {
    const cleanText = stripTags(text).trim()
    if (cleanText === href) return href
    return `[${cleanText}](${href})`
  })

  // Images
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, '![]($1)')

  // Unordered lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_match, content) => {
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, item: string) => {
      return `- ${stripTags(item).trim()}\n`
    }) + '\n'
  })

  // Ordered lists
  let listCounter = 0
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_match, content) => {
    listCounter = 0
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, item: string) => {
      listCounter++
      return `${listCounter}. ${stripTags(item).trim()}\n`
    }) + '\n'
  })

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, content) => {
    return stripTags(content).trim().split('\n').map((line: string) => `> ${line}`).join('\n') + '\n\n'
  })

  // Horizontal rules
  md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n\n')

  // Line breaks
  md = md.replace(/<br[^>]*\/?>/gi, '\n')

  // Paragraphs
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_match, content) => {
    const text = stripTags(content).trim()
    if (!text) return '\n'
    return text + '\n\n'
  })

  // Strip remaining tags
  md = stripTags(md)

  // Decode HTML entities
  md = md.replace(/&amp;/g, '&')
  md = md.replace(/&lt;/g, '<')
  md = md.replace(/&gt;/g, '>')
  md = md.replace(/&quot;/g, '"')
  md = md.replace(/&#39;/g, "'")
  md = md.replace(/&nbsp;/g, ' ')
  md = md.replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(parseInt(code)))

  // Clean up excessive whitespace
  md = md.replace(/\n{3,}/g, '\n\n')
  md = md.trim() + '\n'

  return md
}

/**
 * Strip HTML tags from a string
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
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
