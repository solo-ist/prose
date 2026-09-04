import { create } from 'zustand'
import { parseMarkdown, prepareTextContent } from './markdown'
import { extractMarkdownFromHtml } from './htmlExport'
import { useNotificationStore } from '../stores/notificationStore'
import { useTabStore } from '../stores/tabStore'
import { useEditorStore } from '../stores/editorStore'

/**
 * Disk-sync tracking for open documents (#843 minimal slice, on top of #829).
 *
 * Prose has no runtime watcher on open files, so external edits (another
 * editor, git, an agent) are invisible while a tab is open — and a save from
 * that tab silently clobbers them. This module tracks, per path, the disk
 * mtime from the last moment our in-memory content agreed with the file
 * ("baseline"), enabling two guards:
 *
 * - focus check (App.tsx): on window focus, stale+clean tabs reload from
 *   disk; stale+dirty tabs get the conflict toast.
 * - save guards (useEditor manual save, useAutosave): a save onto a
 *   newer-than-baseline file is intercepted — dialog on manual save,
 *   skip-and-toast on autosave — instead of overwriting silently.
 *
 * The baseline map is module state keyed by absolute path — a cache of
 * filesystem facts, not UI state; paths are unique across all tabs/editors.
 * No baseline for a path (files opened before this shipped, sync-written
 * files) means "unknown" and every guard stays silent — exactly the
 * pre-#843 behavior, never a false conflict.
 */
const baselines = new Map<string, number>()

/** Stat a file's mtime in ms; null when unavailable (missing file, no API). */
export async function statMtimeMs(path: string): Promise<number | null> {
  if (!window.api?.fileStat) return null
  try {
    const stat = await window.api.fileStat(path)
    return new Date(stat.modifiedAt).getTime()
  } catch {
    return null
  }
}

/**
 * Record that our in-memory content agrees with the file at `path` as of now
 * (after a load or a successful save). Pass `mtimeMs` when already known —
 * e.g. session restore reuses the snapshot's savedAt.
 */
export async function recordDiskBaseline(path: string, mtimeMs?: number): Promise<void> {
  const value = mtimeMs ?? (await statMtimeMs(path))
  if (value !== null) baselines.set(path, value)
}

export function clearDiskBaseline(path: string): void {
  baselines.delete(path)
}

/**
 * True when the file at `path` changed on disk after our recorded baseline.
 * No baseline, missing file, or stat failure all read as "not newer" —
 * conservative against false conflicts. The 1ms slack absorbs ISO-string
 * rounding of the mtime.
 */
export async function isDiskNewerThanBaseline(path: string): Promise<boolean> {
  const baseline = baselines.get(path)
  if (baseline === undefined) return false
  const mtime = await statMtimeMs(path)
  if (mtime === null) return false
  return mtime > baseline + 1
}

/**
 * Read + parse a document from disk with the same handling as
 * openFileFromPath (HTML extraction, .txt preparation). Returns null when the
 * read/parse fails — callers fall back to what they already hold.
 */
export async function readDocumentFromDisk(
  path: string
): Promise<{ content: string; frontmatter: Record<string, unknown> } | null> {
  if (!window.api) return null
  try {
    let raw = await window.api.readFile(path)
    if (path.endsWith('.html') || path.endsWith('.htm')) {
      const extracted = extractMarkdownFromHtml(raw)
      if (!extracted) return null
      raw = extracted
    }
    const parsed = parseMarkdown(path.endsWith('.txt') ? prepareTextContent(raw) : raw)
    return { content: parsed.content, frontmatter: parsed.frontmatter }
  } catch {
    return null
  }
}

/**
 * Replace a tab's content with the disk version — the user chose "Load disk
 * version" on a conflict, or a clean tab went stale (#829/#843). Pushes into
 * the live editor too when the tab is active, and refreshes the baseline.
 */
export async function loadDiskVersionIntoTab(tabId: string, path: string): Promise<void> {
  const disk = await readDocumentFromDisk(path)
  if (!disk) {
    useNotificationStore.getState().notify({
      id: `restore-conflict-load-failed:${path}`,
      message: 'Could not read the file from disk — the tab still holds your draft.',
    })
    return
  }
  const { tabs, activeTabId, updateTab } = useTabStore.getState()
  const tab = tabs.find((t) => t.id === tabId)
  if (!tab) return
  updateTab(tabId, { content: disk.content, frontmatter: disk.frontmatter, isDirty: false })
  if (activeTabId === tabId) {
    useEditorStore.getState().setDocument({
      documentId: tab.documentId,
      path,
      content: disk.content,
      frontmatter: disk.frontmatter,
      isDirty: false,
    })
  }
  await recordDiskBaseline(path)
}

/**
 * Persistent toast for an external-edit conflict on an OPEN tab: the file
 * changed on disk while this tab holds unsaved edits. Nothing is lost yet —
 * the draft stays; saving from the tab overwrites the disk edits (the manual
 * save guard will re-confirm). Refreshes in place on repeat triggers.
 */
export function notifyExternalEditConflict(tabId: string, path: string): void {
  const fileName = path.split('/').pop() ?? path
  useNotificationStore.getState().notify({
    id: `external-edit-conflict:${path}`,
    durationMs: 0,
    message: `"${fileName}" changed on disk outside Prose, and this tab has unsaved edits. Saving will overwrite the disk version.`,
    actionLabel: 'Load disk version',
    onAction: () => {
      void loadDiskVersionIntoTab(tabId, path)
    },
  })
}

/**
 * Pending manual-save conflict (#843): a ⌘S landed on a file that changed on
 * disk after our baseline. The save is held; App renders a dialog offering
 * overwrite / load disk / cancel. `content` is the serialized document
 * captured at save time so "overwrite" writes exactly what the user saved.
 */
interface SaveConflictState {
  conflict: { path: string; content: string } | null
  setConflict: (conflict: { path: string; content: string }) => void
  clearConflict: () => void
}

export const useSaveConflictStore = create<SaveConflictState>((set) => ({
  conflict: null,
  setConflict: (conflict) => set({ conflict }),
  clearConflict: () => set({ conflict: null }),
}))
