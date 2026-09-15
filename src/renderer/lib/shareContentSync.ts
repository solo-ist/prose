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
 * Both modes mark shareDirty the moment the document GOES dirty, not just on
 * save: content only ever pushes from a save (disk is the source of truth),
 * but a ◎ reading "synced" over unsaved edits would be a lie — with autosave
 * off a doc can sit dirty indefinitely.
 *
 * Failures degrade to shareDirty + status error/offline and retry on the
 * next save; local state is never blocked on the gateway.
 */
import { useEffect } from 'react'
import { getApi } from './browserApi'
import { isWebPlatformEnabled } from './featureFlags'
import { buildShareArtifact } from './shareArtifact'
import { awaitPendingPushes, backfillShareThreads, flushPendingShareOps } from './sharePush'
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
    // Threads created before the doc was shared have no server row (the
    // on-create push had no publication to hit) — push them NOW, before
    // baking, so the artifact bakes under server ids and viewer replies to
    // those threads have a live row to land on.
    await backfillShareThreads()
    // Drain any comment/reply/resolve push still assigning its shareId before
    // baking: a reply baked under its local id while its push is in flight
    // would collide with the same reply arriving via the live poll under its
    // server id, and the viewer would show it twice. (Manual QA, 2026-09-15.)
    await awaitPendingPushes()
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
        const share = useShareStore.getState()
        if (!share.entry || share.entry.revokedAt) return
        if (isDirty && !prevDirty) {
          // The share diverged the moment the document went dirty — surface
          // it now, not at save time. With autosave off a doc can sit dirty
          // indefinitely, and a "synced" ◎ over unpushed edits is a lie
          // (content still only pushes on save: disk stays the source of
          // truth).
          share.markShareDirty()
          return
        }
        if (!isDirty && prevDirty) {
          // The save transition: push (auto) or leave the badge (publish).
          share.markShareDirty()
          if (share.entry.syncMode === 'auto') scheduleAutoPush(AUTO_PUSH_QUIET_MS)
        }
      }
    )

    const unsubDoc = useEditorStore.subscribe(
      // BOTH identity fields: the entry lookup keys on path, and restore /
      // open flows can set documentId and path in separate store updates. A
      // documentId-only subscription can fire while path is still null — the
      // refresh then caches entry:null and nothing ever re-runs it (live QA
      // caught exactly this: a stable null entry silently disabling every
      // save-driven push).
      (s) => `${s.document.documentId}|${s.document.path ?? ''}`,
      () => {
        // Per-document view state: a pending push must not target the wrong doc.
        cancelScheduledPush()
        useShareStore.setState({ shareDirty: false, lastError: null, lastErrorCode: null, unseenComments: 0 })
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
