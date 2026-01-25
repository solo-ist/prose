import { createDoc, updateDoc, getDoc, getDocMetadata, docExists, extractDocId } from './client'

export interface PushResult {
  success: boolean
  docId?: string
  webViewLink?: string
  error?: string
  isNew: boolean
}

export interface PullResult {
  success: boolean
  content?: string
  modifiedTime?: string
  error?: string
}

interface Frontmatter {
  google_doc_id?: string
  google_synced_at?: string
  [key: string]: unknown
}

/**
 * Push document to Google Docs
 * Creates new doc if no google_doc_id in frontmatter, updates existing otherwise
 */
export async function pushToGoogle(
  content: string,
  frontmatter: Frontmatter,
  title: string
): Promise<PushResult> {
  try {
    const rawDocId = frontmatter.google_doc_id
    const existingDocId = rawDocId ? extractDocId(String(rawDocId)) : undefined

    if (existingDocId) {
      // Check if doc still exists
      const exists = await docExists(existingDocId)
      if (!exists) {
        return {
          success: false,
          error: 'The linked Google Doc no longer exists. Would you like to create a new one?',
          isNew: false
        }
      }

      // Update existing document
      await updateDoc(existingDocId, content)
      const metadata = await getDocMetadata(existingDocId)

      return {
        success: true,
        docId: existingDocId,
        webViewLink: metadata.webViewLink,
        isNew: false
      }
    } else {
      // Create new document
      const docId = await createDoc(title, content)
      const metadata = await getDocMetadata(docId)

      return {
        success: true,
        docId,
        webViewLink: metadata.webViewLink,
        isNew: true
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: errorMessage,
      isNew: false
    }
  }
}

/**
 * Pull document content from Google Docs
 */
export async function pullFromGoogle(rawDocId: string): Promise<PullResult> {
  try {
    const docId = extractDocId(rawDocId)
    // Check if doc exists
    const exists = await docExists(docId)
    if (!exists) {
      return {
        success: false,
        error: 'The linked Google Doc no longer exists or you no longer have access to it.'
      }
    }

    // Get document content
    const content = await getDoc(docId)
    const metadata = await getDocMetadata(docId)

    return {
      success: true,
      content,
      modifiedTime: metadata.modifiedTime
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: errorMessage
    }
  }
}

/**
 * Import a Google Doc by ID
 */
export async function importFromGoogle(rawDocId: string): Promise<{
  success: boolean
  content?: string
  title?: string
  error?: string
}> {
  try {
    const docId = extractDocId(rawDocId)
    const content = await getDoc(docId)
    const metadata = await getDocMetadata(docId)

    return {
      success: true,
      content,
      title: metadata.title
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: errorMessage
    }
  }
}
