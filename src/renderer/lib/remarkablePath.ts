/**
 * Helpers for reasoning about reMarkable sync paths.
 *
 * reMarkable sync writes its read-only OCR / typed-text markdown under the hidden
 * `<syncDir>/.remarkable/<notebookId>/<name>.md` path. The editor store derives its
 * read-only state from this path (see `remarkableStateForPath` in editorStore,
 * applied wherever the document is set) rather than tracking a free-floating flag —
 * so read-only follows the document across tab switches AND session restore, and
 * the hidden source file can never be opened as editable (a stray Cmd+S there would
 * clobber the sync-managed output, which the next sync would overwrite anyway).
 */

const REMARKABLE_HIDDEN_SEGMENT = '/.remarkable/'

/** True for a hidden read-only reMarkable OCR / typed-text markdown file. */
export function isRemarkableOcrPath(path: string | null | undefined): boolean {
  return !!path && path.includes(REMARKABLE_HIDDEN_SEGMENT) && path.endsWith('.md')
}

/**
 * Extract the reMarkable notebook id from an OCR path
 * (`…/.remarkable/<notebookId>/<name>.md`), or null if the path isn't one.
 */
export function remarkableNotebookIdFromPath(path: string | null | undefined): string | null {
  if (!path) return null
  const match = path.match(/\/\.remarkable\/([^/]+)\//)
  return match ? match[1] : null
}
