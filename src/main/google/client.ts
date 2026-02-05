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
 * Represents a parsed list block from Google Docs
 */
interface ListBlock {
  tag: 'ul' | 'ol'
  baseClass: string  // e.g., "lst-kix_pbuofgg1u4ns"
  level: number      // 0, 1, 2, etc. from class suffix
  content: string    // innerHTML of the list
  fullMatch: string  // Full HTML including tags
  startIndex: number
  endIndex: number
}

/**
 * Extract list class info from Google Docs list element.
 * Google Docs uses classes like "lst-kix_abc123-0" where -0, -1, -2 indicates nesting level.
 */
function parseListClass(attrs: string): { baseClass: string; level: number } | null {
  // Match Google Docs list class pattern: lst-kix_xxxxx-N or lst-kix_xxxxx_xxxxx-N
  const classMatch = attrs.match(/class="[^"]*\b(lst-[a-z0-9_]+)-(\d+)\b[^"]*"/i)
  if (classMatch) {
    return {
      baseClass: classMatch[1],
      level: parseInt(classMatch[2], 10)
    }
  }
  return null
}

/**
 * Find all list blocks in HTML and parse their class-based nesting levels.
 */
function findListBlocks(html: string): ListBlock[] {
  const blocks: ListBlock[] = []
  const listPattern = /<(ul|ol)([^>]*)>([\s\S]*?)<\/\1>/gi
  let match

  while ((match = listPattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase() as 'ul' | 'ol'
    const attrs = match[2]
    const content = match[3]
    const classInfo = parseListClass(attrs)

    blocks.push({
      tag,
      baseClass: classInfo?.baseClass || '',
      level: classInfo?.level ?? 0,
      content,
      fullMatch: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length
    })
  }

  return blocks
}

/**
 * Check if two list blocks are consecutive (only whitespace between them).
 */
function areConsecutive(html: string, block1: ListBlock, block2: ListBlock): boolean {
  const between = html.substring(block1.endIndex, block2.startIndex)
  return /^\s*$/.test(between)
}

/**
 * Check if two blocks belong to the same logical list.
 *
 * Google Docs uses the same base class for items in a list, but creates NEW
 * base classes when switching list types at nested levels. For example:
 *   1. Parent (lst-kix_abc-0)
 *      - Child (lst-kix_abc-1)
 *   2. Parent2 (lst-kix_abc-0)
 *      a. Nested ordered (lst-kix_xyz-1) <- Different base class!
 *
 * So we consider blocks as same family if:
 * 1. Same base class, OR
 * 2. Adjacent levels (one is nested under the other) - handles type switches
 */
function areSameListFamily(block1: ListBlock, block2: ListBlock): boolean {
  // Same base class is definitely same family
  if (block1.baseClass && block2.baseClass && block1.baseClass === block2.baseClass) {
    return true
  }

  // Adjacent levels (0→1 or 1→0, etc.) are likely the same logical list
  // even if Google assigned different class IDs due to type switching
  const levelDiff = Math.abs(block1.level - block2.level)
  if (levelDiff === 1) {
    return true
  }

  // Same level with different classes could still be continuation
  // (e.g., after nested content returns to parent level)
  // But we need to be careful not to merge unrelated lists
  // For now, only merge if levels are adjacent
  return false
}

/**
 * Merge consecutive list blocks that belong to the same list family into nested structure.
 *
 * The key insight is that when going from level N to level N+1, the nested content
 * must be inserted INSIDE the last <li> of level N, not as a sibling.
 *
 * Example: blocks with levels [0, 1, 0] should produce:
 *   <ul>
 *     <li>Item 1</li>
 *     <li>Item 2
 *       <ul>
 *         <li>Nested 1</li>
 *         <li>Nested 2</li>
 *       </ul>
 *     </li>
 *     <li>Item 3</li>
 *   </ul>
 */
function mergeListBlocks(blocks: ListBlock[]): string {
  if (blocks.length === 0) return ''
  if (blocks.length === 1) {
    const b = blocks[0]
    return `<${b.tag}>${b.content}</${b.tag}>`
  }

  // Process blocks and build nested structure
  // We need to track when to insert nested content inside the last <li>

  interface ProcessedBlock {
    tag: string
    level: number
    items: string[] // Individual <li>...</li> elements
  }

  // Parse each block's content into individual list items
  const processed: ProcessedBlock[] = blocks.map(b => {
    const items: string[] = []
    const liPattern = /<li[^>]*>[\s\S]*?<\/li>/gi
    let match
    while ((match = liPattern.exec(b.content)) !== null) {
      items.push(match[0])
    }
    return { tag: b.tag, level: b.level, items }
  })

  // Build the nested structure recursively
  let blockIndex = 0

  function buildLevel(targetLevel: number): string {
    if (blockIndex >= processed.length) return ''

    const block = processed[blockIndex]
    if (block.level !== targetLevel) return ''

    blockIndex++
    let html = ''

    // Process each item in this block
    for (let i = 0; i < block.items.length; i++) {
      const item = block.items[i]
      const isLast = i === block.items.length - 1

      // Check if next block is nested under this one
      const nextBlock = blockIndex < processed.length ? processed[blockIndex] : null
      const hasNestedContent = isLast && nextBlock && nextBlock.level > targetLevel

      if (hasNestedContent) {
        // Insert nested content inside this <li>
        // Remove closing </li> tag, add nested list, then close
        const itemWithoutClose = item.replace(/<\/li>$/i, '')
        const nestedTag = nextBlock!.tag
        const nestedContent = buildLevel(nextBlock!.level)
        html += `${itemWithoutClose}<${nestedTag}>${nestedContent}</${nestedTag}></li>`
      } else {
        html += item
      }
    }

    // Check if there's more content at this level after nested content
    while (blockIndex < processed.length && processed[blockIndex].level === targetLevel) {
      const continueBlock = processed[blockIndex]
      blockIndex++

      for (let i = 0; i < continueBlock.items.length; i++) {
        const item = continueBlock.items[i]
        const isLast = i === continueBlock.items.length - 1

        const nextBlock = blockIndex < processed.length ? processed[blockIndex] : null
        const hasNestedContent = isLast && nextBlock && nextBlock.level > targetLevel

        if (hasNestedContent) {
          const itemWithoutClose = item.replace(/<\/li>$/i, '')
          const nestedTag = nextBlock!.tag
          const nestedContent = buildLevel(nextBlock!.level)
          html += `${itemWithoutClose}<${nestedTag}>${nestedContent}</${nestedTag}></li>`
        } else {
          html += item
        }
      }
    }

    return html
  }

  const firstBlock = processed[0]
  const content = buildLevel(firstBlock.level)
  return `<${firstBlock.tag}>${content}</${firstBlock.tag}>`
}

/**
 * Pre-process Google Docs HTML to reconstruct nested lists.
 *
 * Google Docs exports nested lists as SEPARATE <ul>/<ol> elements with class names
 * like "lst-kix_abc123-0", "lst-kix_abc123-1" where the suffix indicates nesting level.
 * This function finds consecutive lists belonging to the same family and merges them
 * into properly nested HTML structure.
 */
function reconstructNestedLists(html: string): string {
  const blocks = findListBlocks(html)

  if (DEBUG_GOOGLE_DOCS_HTML && blocks.length > 0) {
    console.log('[GoogleDocs] Found list blocks:')
    blocks.forEach((b, i) => {
      console.log(`  [${i}] ${b.tag} class="${b.baseClass}-${b.level}" level=${b.level}`)
    })
  }

  if (blocks.length === 0) return html

  // Group consecutive blocks that belong to the same list family
  const groups: ListBlock[][] = []
  let currentGroup: ListBlock[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (currentGroup.length === 0) {
      currentGroup.push(block)
    } else {
      const lastBlock = currentGroup[currentGroup.length - 1]
      // Check if this block should join the current group
      if (areConsecutive(html, lastBlock, block) && areSameListFamily(lastBlock, block)) {
        currentGroup.push(block)
      } else {
        // Start a new group
        if (currentGroup.length > 1) {
          groups.push(currentGroup)
        }
        currentGroup = [block]
      }
    }
  }

  // Don't forget the last group
  if (currentGroup.length > 1) {
    groups.push(currentGroup)
  }

  if (DEBUG_GOOGLE_DOCS_HTML && groups.length > 0) {
    console.log('[GoogleDocs] List groups to merge:', groups.length)
    groups.forEach((g, i) => {
      console.log(`  Group ${i}: ${g.length} blocks, levels: ${g.map(b => b.level).join(',')}`)
    })
  }

  // Replace each group with merged nested structure
  // Process in reverse order to maintain correct indices
  let result = html
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]
    const startIndex = group[0].startIndex
    const endIndex = group[group.length - 1].endIndex
    const merged = mergeListBlocks(group)

    if (DEBUG_GOOGLE_DOCS_HTML) {
      console.log('[GoogleDocs] Merged list:', merged.substring(0, 200) + '...')
    }

    result = result.substring(0, startIndex) + merged + result.substring(endIndex)
  }

  return result
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
