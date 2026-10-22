import { create } from 'zustand'
import { getApi } from '../lib/browserApi'
import { useNotificationStore } from './notificationStore'

/**
 * Gateway session state (#1059).
 *
 * This state machine used to live in `ShareDialog`'s local `useState`, which meant
 * it existed only while that dialog was open and could not be shown anywhere else.
 * Settings → Account needs the same state, and two copies would be free to disagree
 * about who is signed in — so it lives here and both surfaces render from it.
 *
 * Deliberately session state only: no entitlements (that is #953/#955) and no
 * per-document publication state (that is `shareStore` / `sharedListStore`).
 */

export type AuthState =
  | { phase: 'loading' }
  /** `codeSentTo`: the address a code was just mailed to, or null. */
  | { phase: 'signed-out'; codeSentTo: string | null }
  | { phase: 'signed-in'; email?: string }

/**
 * Beta standing once signed in. 'unknown' (an older gateway, or offline) falls back
 * to the Publish button; the gateway still enforces the grant.
 */
export type Access = 'unknown' | 'can-publish' | 'not-invited' | 'requested'

interface AccountState {
  auth: AuthState
  access: Access
  /** Which action is in flight, or null. Used to disable the whole form at once. */
  busy: string | null
  error: string | null
  /** Controlled inputs, shared so the two surfaces do not fight over a half-typed address. */
  emailInput: string
  codeInput: string
  /**
   * How many account surfaces are currently visible. A deep-link sign-in that lands
   * while one is open is shown in place; with none open it becomes a toast instead.
   */
  visibleSurfaces: number

  setEmailInput: (value: string) => void
  setCodeInput: (value: string) => void
  clearError: () => void
  refresh: () => Promise<void>
  requestCode: () => Promise<void>
  completeSignIn: (digits: string) => Promise<void>
  useDifferentEmail: () => void
  signOut: () => Promise<void>
  requestAccess: () => Promise<void>
  surfaceShown: () => void
  surfaceHidden: () => void
  setAccess: (access: Access) => void
  /**
   * Run an action under the same busy/error handling as the sign-in actions.
   * The Share dialog's Publish shares it so one in-flight action disables the
   * whole surface, sign-in controls included.
   */
  runAction: (label: string, action: () => Promise<string | null>) => Promise<void>
}

export const useAccountStore = create<AccountState>((set, get) => ({
  auth: { phase: 'loading' },
  access: 'unknown',
  busy: null,
  error: null,
  emailInput: '',
  codeInput: '',
  visibleSurfaces: 0,

  setEmailInput: (value) => set({ emailInput: value }),
  setCodeInput: (value) => set({ codeInput: value }),
  clearError: () => set({ error: null }),

  refresh: async () => {
    set({ error: null })
    const status = await getApi().shareAuthStatus()
    if (status.ok && status.signedIn) {
      const standing = await getApi().shareAccess()
      set({
        access: !standing.ok
          ? 'unknown'
          : standing.canPublish
            ? 'can-publish'
            : standing.requested
              ? 'requested'
              : 'not-invited',
        auth: { phase: 'signed-in', email: status.email },
      })
    } else {
      set({ access: 'unknown', auth: { phase: 'signed-out', codeSentTo: null } })
    }
  },

  requestCode: async () => {
    await run(set, 'request', async () => {
      const address = get().emailInput.trim()
      const res = await getApi().shareRequestSignIn(address)
      if (!res.ok) return res.error
      set({ codeInput: '', auth: { phase: 'signed-out', codeSentTo: address } })
      return null
    })
  },

  completeSignIn: async (digits) => {
    await run(set, 'complete', async () => {
      const res = await getApi().shareCompleteSignIn(digits)
      if (!res.ok) {
        // Every failure leaves the typed code unusable (wrong, expired, or burned),
        // so clear it for the next attempt.
        set({ codeInput: '' })
        return res.error
      }
      set({ codeInput: '' })
      await get().refresh()
      return null
    })
  },

  useDifferentEmail: () =>
    set({ codeInput: '', error: null, auth: { phase: 'signed-out', codeSentTo: null } }),

  // Main revokes the session on the gateway (best effort) and always drops the
  // stored cookie. Existing share links keep working; managing them needs a
  // sign-in again.
  signOut: async () => {
    await run(set, 'signout', async () => {
      const res = await getApi().shareSignOut()
      if (!res.ok) return res.error
      set({
        emailInput: '',
        codeInput: '',
        access: 'unknown',
        auth: { phase: 'signed-out', codeSentTo: null },
      })
      return null
    })
  },

  requestAccess: async () => {
    await run(set, 'request-access', async () => {
      const res = await getApi().shareRequestAccess()
      if (!res.ok) return res.error
      set({ access: res.canPublish ? 'can-publish' : 'requested' })
      return null
    })
  },

  surfaceShown: () => set((s) => ({ visibleSurfaces: s.visibleSurfaces + 1 })),
  surfaceHidden: () => set((s) => ({ visibleSurfaces: Math.max(0, s.visibleSurfaces - 1) })),
  setAccess: (access) => set({ access }),
  runAction: (label, action) => run(set, label, action),
}))

type Set = (partial: Partial<AccountState>) => void

/** Run an action with the shared busy/error handling every handler needs. */
async function run(set: Set, label: string, action: () => Promise<string | null>): Promise<void> {
  set({ busy: label, error: null })
  try {
    const err = await action()
    if (err) set({ error: err })
  } finally {
    set({ busy: null })
  }
}

/**
 * The sign-in email's "Open in Prose" link completes the sign-in in the main process
 * (#964), so the result arrives as an event rather than as the return of a call we
 * made. One subscription for the whole app: a visible surface shows the outcome in
 * place, and with none visible it becomes a toast so the sign-in is not silent.
 */
let deepLinkBound = false

export function bindAccountDeepLink(): void {
  if (deepLinkBound) return
  const off = getApi().onShareAuthChanged?.((result) => {
    if (!off) return
    const store = useAccountStore.getState()
    if (store.visibleSurfaces > 0) {
      store.setCodeInput('')
      if (result.ok) void store.refresh()
      else useAccountStore.setState({ error: result.error })
      return
    }
    if (result.ok) void store.refresh()
    useNotificationStore.getState().notify({
      id: 'share-sign-in',
      message: result.ok
        ? `Signed in to sharing${result.email ? ` as ${result.email}` : ''}.`
        : result.error,
    })
  })
  if (off) deepLinkBound = true
}
