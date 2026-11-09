/**
 * Remote access (#1239): the shapes main, the preload and the renderer share
 * for Settings → Integrations → Connections. Types only.
 */
import type { RemoteScope } from './remoteScopes'

export type RemoteConnectionStatus = 'pending' | 'approved' | 'denied'

export interface RemoteConnection {
  /** The actor's connection id: `remote:<client id>` (or a hash of it, past the actor's length cap). */
  id: string
  /** The gateway's OAuth client id (a CIMD URL, or a DCR id). */
  clientId: string
  /** The name the client registered with at the gateway. */
  clientName: string
  /** Identified by its Client ID Metadata Document (domain ownership), not self-registered. */
  verified: boolean
  /** The writer's name for it; records are attributed to it. */
  label: string
  status: RemoteConnectionStatus
  /** What the writer approved. `read` is always included once approved. */
  scopes: RemoteScope[]
  firstSeenAt: number
  approvedAt: number | null
  lastUsedAt: number | null
}

export type RelayState =
  | 'off' // Remote access is off
  | 'unavailable' // the Mac App Store build
  | 'signed-out' // no gateway session (or it ended)
  | 'connecting'
  | 'connected'
  | 'reconnecting' // waiting to try again; `error` says why
  | 'replaced' // another window of this profile took the socket

export interface RemoteAccessStatus {
  /** False on the Mac App Store build. */
  available: boolean
  /** The Remote access switch. */
  enabled: boolean
  /** A gateway session exists for the configured gateway. */
  signedIn: boolean
  state: RelayState
  error?: string
  /**
   * While connected: whether remote calls come to this Mac (it is the
   * account's most recently active desktop) or go to another one.
   */
  receiving?: boolean
  /** Remote clients waiting for the writer to approve or decline them. */
  pendingCount: number
  /** What to paste into ChatGPT or claude.ai. */
  connectorUrl: string
}

export type RemoteChange = { reason: 'status' } | { reason: 'list' } | { reason: 'pending'; clientName: string }

export type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Deny and remove refuse the client in the app at once, then ask the gateway to revoke it. */
export interface RemoteForgetResult {
  revokedAtGateway: boolean
  error?: string
}
