/**
 * Import from the App Store edition (#1243): the first-launch offer, the
 * Settings confirmation, the one-time summary with its API-key step, and the
 * Settings row. The copy itself runs in main at the next launch
 * (`src/main/appStoreImport.ts`); this side only asks, and reports.
 */
import { create } from 'zustand'
import type { AppStoreImportStatus } from '../../../shared/appStoreImport'
import { getApi } from '../../lib/browserApi'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog'

type KeyOutcome = 'idle' | 'working' | 'imported' | 'failed' | 'skipped'

interface AppStoreImportState {
  /** Whether the status call has answered (or there is nothing to ask). */
  loaded: boolean
  status: AppStoreImportStatus | null
  /** The first-launch offer is showing. Onboarding waits for it. */
  offerOpen: boolean
  confirmOpen: boolean
  starting: boolean
  error: string | null
  keyOutcome: KeyOutcome
  summaryDone: boolean
  load: () => Promise<void>
  openConfirm: () => void
  closeConfirm: () => void
  start: () => Promise<void>
  decline: () => Promise<void>
  bringKeyOver: () => Promise<void>
  finishSummary: () => Promise<void>
}

// A status call that never answers must not hold onboarding back for good.
const STATUS_TIMEOUT_MS = 3000

export const useAppStoreImportStore = create<AppStoreImportState>((set, get) => ({
  loaded: false,
  status: null,
  offerOpen: false,
  confirmOpen: false,
  starting: false,
  error: null,
  keyOutcome: 'idle',
  summaryDone: false,

  load: async () => {
    const api = getApi().appStoreImport
    if (!api) {
      set({ loaded: true })
      return
    }
    const status = await Promise.race([
      api.status().catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STATUS_TIMEOUT_MS))
    ])
    set({ loaded: true, status, offerOpen: status?.offer === true })
  },

  openConfirm: () => set({ confirmOpen: true, error: null }),
  closeConfirm: () => set({ confirmOpen: false, error: null }),

  start: async () => {
    const api = getApi().appStoreImport
    if (!api || get().starting) return
    // The import replaces this copy's tabs; unsaved changes would be lost.
    if (useTabStore.getState().tabs.some((tab) => tab.isDirty)) {
      set({ error: 'Save or close your unsaved documents first.' })
      return
    }
    set({ starting: true, error: null })
    const result = await api.start().catch(() => ({ ok: false as const, reason: 'unavailable' as const }))
    if (result.ok) return // Prose quits and restarts to copy the data
    set({
      starting: false,
      error: result.reason === 'running'
        ? 'Quit the App Store edition of Prose first, then try again.'
        : 'The App Store edition’s data is no longer on this Mac.'
    })
  },

  decline: async () => {
    set({ offerOpen: false, error: null })
    await getApi().appStoreImport?.decline().catch(() => undefined)
  },

  bringKeyOver: async () => {
    const api = getApi().appStoreImport
    if (!api) return
    set({ keyOutcome: 'working' })
    const result = await api.importKeys().catch(() => ({ imported: [], failed: ['llm-api-key'], skipped: [] }))
    if (result.imported.length > 0) {
      // The key now lives in this copy's secure storage; re-read settings so AI
      // features see it.
      await useSettingsStore.getState().loadSettings()
      set({ keyOutcome: 'imported' })
    } else if (result.failed.length > 0) {
      set({ keyOutcome: 'failed' })
    } else {
      set({ keyOutcome: 'skipped' })
    }
  },

  finishSummary: async () => {
    const api = getApi().appStoreImport
    const { status, keyOutcome } = get()
    set({ summaryDone: true })
    if (!api) return
    // "I'll enter it again": the staged copy is not kept.
    if ((status?.stagedCredentials.length ?? 0) > 0 && keyOutcome === 'idle') {
      await api.discardKeys().catch(() => undefined)
    }
    await api.acknowledge().catch(() => undefined)
  }
}))

/** Whether the post-import summary is due (so other launch prompts can wait). */
export function useAppStoreImportSummaryDue(): boolean {
  return useAppStoreImportStore((s) => {
    const result = s.status?.result
    return !s.summaryDone && !!result && result.state !== 'declined' && !result.acknowledged
  })
}

export function AppStoreImportOffer() {
  const open = useAppStoreImportStore((s) => s.offerOpen)
  const starting = useAppStoreImportStore((s) => s.starting)
  const error = useAppStoreImportStore((s) => s.error)
  const { start, decline } = useAppStoreImportStore.getState()
  return (
    <AlertDialog open={open}>
      <AlertDialogContent data-testid="app-store-import-offer">
        <AlertDialogHeader>
          <AlertDialogTitle>Moving from the App Store edition?</AlertDialogTitle>
          <AlertDialogDescription>
            Prose found the App Store edition on this Mac. It can copy its settings, projects,
            favorites, open tabs and AI history into this copy. Prose restarts to do it, and the
            App Store edition keeps its own copy.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={starting} onClick={() => { void decline() }}>Not now</AlertDialogCancel>
          <AlertDialogAction
            disabled={starting}
            onClick={(event) => { event.preventDefault(); void start() }}
          >
            {starting ? 'Restarting…' : 'Import and restart'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function AppStoreImportConfirm() {
  const open = useAppStoreImportStore((s) => s.confirmOpen)
  const starting = useAppStoreImportStore((s) => s.starting)
  const error = useAppStoreImportStore((s) => s.error)
  const { start, closeConfirm } = useAppStoreImportStore.getState()
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next && !starting) closeConfirm() }}>
      <AlertDialogContent data-testid="app-store-import-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>Import from the App Store edition?</AlertDialogTitle>
          <AlertDialogDescription>
            This replaces this copy’s settings, projects, open tabs and AI history with the App
            Store edition’s. What it replaces is kept in a backup folder inside Prose’s settings
            folder. Prose restarts to do it, and the App Store edition keeps its own copy.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={starting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={starting}
            onClick={(event) => { event.preventDefault(); void start() }}
          >
            {starting ? 'Restarting…' : 'Import and restart'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const FAILURE_TEXT: Record<string, string> = {
  running: 'The App Store edition was open. Quit it, then import again from Settings → General.',
  'nothing-to-import': 'The App Store edition has no data to import.',
  'copy-failed': 'Something went wrong while copying, so nothing was changed. You can try again from Settings → General.'
}

const MAX_LISTED_FILES = 5
// A stable empty list: a fresh `[]` from a selector re-renders forever.
const NO_STAGED: string[] = []

/** The one-time report after an import ran. Waits while `blocked` (onboarding). */
export function AppStoreImportSummary({ blocked }: { blocked: boolean }) {
  const due = useAppStoreImportSummaryDue()
  const result = useAppStoreImportStore((s) => s.status?.result ?? null)
  const staged = useAppStoreImportStore((s) => s.status?.stagedCredentials ?? NO_STAGED)
  const keyOutcome = useAppStoreImportStore((s) => s.keyOutcome)
  const { bringKeyOver, finishSummary } = useAppStoreImportStore.getState()
  if (!result) return null

  const open = due && !blocked
  const imported = result.state === 'imported'
  const containerFiles = result.containerFiles ?? []
  const keyStep = imported && staged.length > 0 && (keyOutcome === 'idle' || keyOutcome === 'working')

  const openLlmSettings = () => {
    void finishSummary()
    useSettingsStore.getState().setDialogOpen(true, 'llm')
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent data-testid="app-store-import-summary" className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {imported ? 'Imported from the App Store edition' : 'The App Store edition’s data wasn’t imported'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {imported
              ? 'Your settings, projects, favorites, open tabs and AI history are here. The App Store edition still has its own copy.'
              : FAILURE_TEXT[result.error ?? 'copy-failed'] ?? FAILURE_TEXT['copy-failed']}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {imported && containerFiles.length > 0 && (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              These are stored inside the App Store edition’s private folder. Move them somewhere
              you choose before you remove that edition:
            </p>
            <ul className="space-y-1" data-testid="app-store-import-container-files">
              {containerFiles.slice(0, MAX_LISTED_FILES).map((path) => (
                <li key={path} className="truncate font-mono text-xs" title={path}>{path}</li>
              ))}
              {containerFiles.length > MAX_LISTED_FILES && (
                <li className="text-xs">and {containerFiles.length - MAX_LISTED_FILES} more</li>
              )}
            </ul>
          </div>
        )}

        {keyStep && (
          <p className="text-sm text-muted-foreground" data-testid="app-store-import-key-step">
            Your API key is saved by the App Store edition. Prose can try to bring it over; macOS
            may ask whether Prose can use “Prose Safe Storage” in your keychain.
          </p>
        )}
        {keyOutcome === 'imported' && <p className="text-sm text-muted-foreground">Your API key is set.</p>}
        {keyOutcome === 'skipped' && (
          <p className="text-sm text-muted-foreground">This copy already has an API key, so it was kept.</p>
        )}
        {keyOutcome === 'failed' && (
          <p className="text-sm text-muted-foreground">
            Prose couldn’t read the key. Enter it in Settings → LLM.
          </p>
        )}

        <AlertDialogFooter>
          {keyStep ? (
            <>
              <AlertDialogCancel disabled={keyOutcome === 'working'} onClick={() => { void finishSummary() }}>
                I’ll enter it again
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={keyOutcome === 'working'}
                onClick={(event) => { event.preventDefault(); void bringKeyOver() }}
              >
                {keyOutcome === 'working' ? 'Bringing it over…' : 'Bring my key over'}
              </AlertDialogAction>
            </>
          ) : keyOutcome === 'failed' ? (
            <>
              <AlertDialogCancel onClick={() => { void finishSummary() }}>Done</AlertDialogCancel>
              <AlertDialogAction onClick={openLlmSettings}>Open Settings</AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction onClick={() => { void finishSummary() }}>Done</AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Settings → General. Renders nothing unless there is an App Store edition to import from. */
export function AppStoreImportSettingsRow() {
  const available = useAppStoreImportStore((s) => s.status?.available === true)
  if (!available) return null
  return (
    <>
      <Separator />
      <div className="flex items-center justify-between gap-4" data-testid="app-store-import-row">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">App Store edition</p>
          <p className="text-xs text-muted-foreground">
            Copy settings, projects, open tabs and AI history from the App Store edition on this Mac.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => useAppStoreImportStore.getState().openConfirm()}>
          Import…
        </Button>
      </div>
    </>
  )
}
