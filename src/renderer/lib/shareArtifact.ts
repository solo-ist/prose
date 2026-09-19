/**
 * shareArtifact.ts — builds the publishable share artifact from the live
 * editor + document state (#768/#769). Extracted from ShareDialog so the
 * background content push (auto sync mode) and the dialog share one builder.
 */
import type { Editor } from '@tiptap/core'
import { getApi } from './browserApi'
import { buildShareHtml } from './htmlExport'
import { extractFirstH1 } from './markdown'
import { useCommentStore } from '../extensions/comments/store'
import { mergeCommentsForPersistence } from '../extensions/comments/extension'

export interface ShareArtifactDoc {
  content: string
  path: string | null
  frontmatter: Record<string, unknown>
  documentId: string
}

export function documentTitle(content: string, path: string | null): string {
  const h1 = extractFirstH1(content)
  if (h1) return h1
  if (path) return (path.split('/').pop() ?? 'Untitled').replace(/\.(md|markdown|txt)$/, '')
  return 'Untitled'
}

/**
 * Render the current document (content + merged comment threads) into a
 * self-contained share artifact. Returns null when the document isn't
 * publishable yet (no editor, unsaved, or empty).
 */
export async function buildShareArtifact(
  editor: Editor | null,
  doc: ShareArtifactDoc
): Promise<{ title: string; html: string } | null> {
  if (!editor || !doc.content || !doc.path) return null
  // Identity guard (TOCTOU). A caller may await between choosing this document
  // and reaching here (auth lookup, thread backfill, push drain). If the active
  // document has since switched, the live editor + comment store now belong to
  // a DIFFERENT document — baking them would publish that document's private
  // content under THIS publication's link. The comment store's documentId
  // tracks the active document, so a mismatch means we switched: refuse.
  if (useCommentStore.getState().documentId !== doc.documentId) return null
  // Snapshot the live editor HTML and comments SYNCHRONOUSLY, before the async
  // auth lookup below — a switch during that await must not swap in another
  // document's content after the identity check has passed.
  const editorHtml = editor.getHTML()
  const merged = mergeCommentsForPersistence(editor, useCommentStore.getState().pendingComments)
  const status = await getApi().shareAuthStatus()
  const gatewayUrl = status.ok ? status.gatewayUrl : ''
  const title = documentTitle(doc.content, doc.path)
  const docDir = doc.path.substring(0, doc.path.lastIndexOf('/')) || null
  const html = await buildShareHtml(
    editorHtml,
    doc.content,
    doc.frontmatter,
    title,
    docDir,
    merged,
    gatewayUrl
  )
  return { title, html }
}
