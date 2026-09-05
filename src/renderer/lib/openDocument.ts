/**
 * openDocument.ts — the single resolution step between raw file bytes and
 * editor-ready source, shared by every file-open path (#768).
 *
 * Prose HTML artifacts carry their source markdown and comment threads
 * embedded in the file. The app has several independent open paths (File →
 * Open dialog, file-explorer clicks and previews, OS open events, MCP/AI
 * tools); each must resolve raw content through here so artifacts always
 * extract their markdown AND import their embedded comments, no matter how
 * the file arrived. Opening an artifact through a path that skips this step
 * loads the raw page HTML as document content and silently drops the
 * travelling comments (the tier-3 sneakernet loop breaks).
 */
import { extractMarkdownFromHtml } from './htmlExport'
import { importArtifactComments } from './artifactImport'
import { prepareTextContent } from './markdown'

export interface ResolvedFileContent {
  /**
   * Editor-ready source (extracted markdown, prepared txt, or the raw bytes).
   * null = an HTML file with no embedded Prose markdown — callers decide
   * whether to refuse the open (dialog/explorer paths) or fall back to the
   * raw content (legacy behavior of the tab/tool paths).
   */
  content: string | null
  /** True when the file was a Prose artifact (markdown extracted, comments imported). */
  isArtifact: boolean
}

/**
 * Resolve a just-read file into editor-ready source. For Prose artifacts this
 * also merges embedded comment threads into `documentId`'s store BEFORE the
 * document loads, so the normal comment-load → restore path picks them up.
 * The import is a stable-ID merge — resolving the same file twice is a no-op.
 */
export async function resolveOpenedFileContent(
  filePath: string,
  raw: string,
  documentId: string
): Promise<ResolvedFileContent> {
  if (filePath.endsWith('.html') || filePath.endsWith('.htm')) {
    const extracted = extractMarkdownFromHtml(raw)
    if (extracted === null) return { content: null, isArtifact: false }
    await importArtifactComments(raw, documentId)
    return { content: extracted, isArtifact: true }
  }
  return {
    content: filePath.endsWith('.txt') ? prepareTextContent(raw) : raw,
    isArtifact: false
  }
}
