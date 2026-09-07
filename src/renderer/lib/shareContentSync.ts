/**
 * shareContentSync.ts — the content half of "content follows the mode" (#769).
 *
 * Auto mode: every save (manual or autosave) schedules a background artifact
 * push after a quiet period, floored to a per-publication minimum interval so
 * a fast typist with 1.5s autosave can't saturate the gateway's per-user rate
 * limit (~20/min) with 8 MB artifacts.
 *
 * Publish mode: saves only mark the share dirty (the icon grows its badge);
 * pushShareContent('manual') — the popover's "Share latest updates" — does
 * the same push on demand.
 *
 * Failures degrade to shareDirty + status error/offline and retry on the
 * next save; local state is never blocked on the gateway.
 */
import { useEffect } from 'react'
import { getApi } from './browserApi'
import { isWebPlatformEnabled } from './featureFlags'
import { buildShareArtifact } from './shareArtifact'
import { flushPendingShareOps } from './sharePush'
import { useEditorStore } from '../stores/editorStore'
import { useEditorInstanceStore } from '../stores/editorInstanceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useShareStore } from '../stores/shareStore'

const AUTO_PUSH_QUIET_MS = 4000
const AUTO_PUSH_MIN_INTERVAL_MS = 15000
const lastPushAt = new Map<string, number>()

let pushTimer: ReturnType<typeof setTimeout> | null = null
let pushInFlight = false

function cancelScheduledPush(): void {
  if (pushTimer !== null) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
}

function scheduleAutoPush(delayMs: number): void {
  cancelScheduledPush()
  pushTimer = setTimeout(() => {
    pushTimer = null
    void pushShareContent('auto')
  }, delayMs)
}

/**
 * Build the current document's artifact and push it to the publication.
 * 'auto' respects the sync mode and the per-publication interval floor;
 * 'manual' (Share latest updates) pushes unconditionally.
 */
export async function pushShareContent(reason: 'auto' | 'manual'): Promise<boolean> {
  if (!isWebPlatformEnabled() || pushInFlight) return false
  const share = useShareStore.getState()
  const entry = share.entry
  if (!entry || entry.revokedAt) return false
  if (reason === 'auto' && entry.syncMode !== 'auto') return false

  const doc = useEditorStore.getState().document
  if (!doc.path || doc.path !== entry.localPath) return false
  if (reason === 'auto' && doc.isDirty) {
    // Typing resumed since the save that scheduled us — the next save
    // transition reschedules. Keep the dirty badge honest and bail.
    return false
  }

  if (reason === 'auto') {
    const wait = AUTO_PUSH_MIN_INTERVAL_MS - (Date.now() - (lastPushAt.get(entry.publicationId) ?? 0))
    if (wait > 0) {
      scheduleAutoPush(wait)
      return false
    }
  }

  pushInFlight = true
  share.setPushing(true)
  try {
    const artifact = await buildShareArtifact(useEditorInstanceStore.getState().editor, {
      content: doc.content,
      path: doc.path,
      frontmatter: doc.frontmatter,
      documentId: doc.documentId,
    })
    if (!artifact) return false
    const res = await getApi().shareRepublish({ publicationId: entry.publicationId, ...artifact })
    if (!res.ok) {
      useShareStore.getState().setError(res.error, res.code ?? null)
      return false
    }
    lastPushAt.set(entry.publicationId, Date.now())
    const store = useShareStore.getState()
    // A doc switch mid-push must not resurrect the old entry on the new doc.
    if (store.entry?.publicationId === entry.publicationId) {
      store.applyEntry(res.entry)
      store.clearShareDirty()
      store.setError(null, null)
    }
    flushPendingShareOps()
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Push failed'
    useShareStore.getState().setError(message, null)
    return false
  } finally {
    pushInFlight = false
    useShareStore.getState().setPushing(false)
  }
}

/**
 * Mount-once engine hook (App.tsx): watches saves (isDirty true→false) to
 * mark the share dirty and schedule auto pushes, and document switches to
 * re-target the share store at the new active document.
 */
export function useShareContentSync(): void {
  useEffect(() => {
    // Settings (and with them the webPlatform flag) load asynchronously —
    // never gate the subscriptions on the flag at mount, or the engine
    // permanently no-ops when it mounts first. Callbacks check at fire time;
    // the flag flipping true re-runs the initial lookup.
    void useShareStore.getState().refreshForActiveDocument()

    const unsubFlag = useSettingsStore.subscribe(
      (s) => s.isLoaded && s.settings.featureFlags?.webPlatform === true,
      (enabled) => {
        if (enabled) void useShareStore.getState().refreshForActiveDocument()
      }
    )

    const unsubSave = useEditorStore.subscribe(
      (s) => s.document.isDirty,
      (isDirty, prevDirty) => {
        if (!prevDirty || isDirty) return // only the save transition (true → false)
        const share = useShareStore.getState()
        if (!share.entry || share.entry.revokedAt) return
        share.markShareDirty()
        if (share.entry.syncMode === 'auto') scheduleAutoPush(AUTO_PUSH_QUIET_MS)
      }
    )

    const unsubDoc = useEditorStore.subscribe(
      (s) => s.document.documentId,
      () => {
        // Per-document view state: a pending push must not target the wrong doc.
        cancelScheduledPush()
        useShareStore.setState({ shareDirty: false, lastError: null, lastErrorCode: null })
        void useShareStore.getState().refreshForActiveDocument()
      }
    )

    // Recovery path: a failed auto push keeps shareDirty — regaining focus
    // (e.g. after the gateway comes back) retries without waiting for the
    // next save. The interval floor in pushShareContent still applies.
    const onFocus = () => {
      const share = useShareStore.getState()
      if (!share.entry || share.entry.revokedAt) return
      if (share.shareDirty && share.entry.syncMode === 'auto') scheduleAutoPush(1000)
    }
    window.addEventListener('focus', onFocus)

    return () => {
      unsubFlag()
      unsubSave()
      unsubDoc()
      window.removeEventListener('focus', onFocus)
      cancelScheduledPush()
    }
  }, [])
}
