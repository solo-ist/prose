/**
 * Remote access (#1239): the relay socket, the call handler and the remote
 * connection store wired together, and their IPC for Settings → Integrations
 * → Connections. Every handler refuses on the Mac App Store build, which
 * never dials out.
 *
 *   mcp:remote:status     { available, enabled, signedIn, state, error?, connectorUrl }
 *   mcp:remote:setEnabled the switch (on: connect; off: close at once)
 *   mcp:remote:list       the remote connections (pending, approved, declined)
 *   mcp:remote:approve    approve a pending client with scopes (and a label)
 *   mcp:remote:update     change an approved client's scopes or label
 *   mcp:remote:deny       decline a client (and revoke it at the gateway)
 *   mcp:remote:remove     forget a client (and revoke it at the gateway)
 *   → mcp:remote:changed  pushed to the window when any of it changes
 */

import { join } from 'path'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { IS_MAS_BUILD } from '../env'
import { RemoteConnectionError, RemoteConnectionStore } from './remoteConnections'
import { RelayClient } from './relay'
import type {
  RelayState,
  RemoteAccessStatus,
  RemoteChange,
  RemoteConnection,
  RemoteForgetResult,
  RemoteResult
} from '../../shared/mcp/remoteAccess'
import { RelayCallHandler, parseCallFrame } from './relayCalls'
import type { McpToolInvoker } from './http-server'

const MAS_ERROR = 'Remote access is not available in the Mac App Store version.'

let store: RemoteConnectionStore | null = null
let relay: RelayClient | null = null
let calls: RelayCallHandler | null = null
let window: BrowserWindow | null = null
let unsubscribeSession: (() => void) | null = null

/** The profile's remote connection store, resolved on first use (after userData is set). */
export function getRemoteConnectionStore(): RemoteConnectionStore {
  if (!store) store = new RemoteConnectionStore(join(app.getPath('userData'), 'mcp-remote.json'))
  return store
}

function notify(change: RemoteChange): void {
  if (window && !window.isDestroyed()) window.webContents.send('mcp:remote:changed', change)
}

async function status(): Promise<RemoteAccessStatus> {
  if (IS_MAS_BUILD) return { available: false, enabled: false, signedIn: false, state: 'unavailable', connectorUrl: '' }
  const share = await import('../share/index')
  const s = getRemoteConnectionStore()
  const current = relay?.status ?? { state: 'off' as RelayState }
  return {
    available: true,
    enabled: s.enabled,
    signedIn: (await share.relayEndpoint(s.deviceId)) !== null,
    state: s.enabled ? current.state : 'off',
    ...(current.error && s.enabled ? { error: current.error } : {}),
    connectorUrl: await share.relayConnectorUrl()
  }
}

function run<T>(action: () => T): RemoteResult<T> {
  if (IS_MAS_BUILD) return { ok: false, error: MAS_ERROR }
  try {
    return { ok: true, value: action() }
  } catch (err) {
    if (err instanceof RemoteConnectionError) return { ok: false, error: err.message }
    console.error('[MCP relay] Connection operation failed:', err)
    return { ok: false, error: 'The connection could not be saved' }
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Refuse locally first (at once), then ask the gateway to revoke; report a failed revoke. */
async function forget(clientId: string, change: (s: RemoteConnectionStore) => void): Promise<RemoteResult<RemoteForgetResult>> {
  const local = run(() => change(getRemoteConnectionStore()))
  if (!local.ok) return local
  notify({ reason: 'list' })
  const share = await import('../share/index')
  const revoked = await share.revokeRelayClient(clientId)
  return { ok: true, value: revoked.ok ? { revokedAtGateway: true } : { revokedAtGateway: false, error: revoked.error } }
}

export function setupRemoteAccessHandlers(): void {
  ipcMain.handle('mcp:remote:status', () => status())

  ipcMain.handle('mcp:remote:setEnabled', async (_event, enabled: unknown): Promise<RemoteResult<RemoteAccessStatus>> => {
    const set = run(() => getRemoteConnectionStore().setEnabled(enabled === true))
    if (!set.ok) return set
    if (enabled === true) relay?.start()
    else relay?.stop()
    notify({ reason: 'status' })
    return { ok: true, value: await status() }
  })

  ipcMain.handle('mcp:remote:list', (): RemoteResult<RemoteConnection[]> => run(() => getRemoteConnectionStore().list()))

  ipcMain.handle('mcp:remote:approve', (_event, clientId: unknown, scopes: unknown, label: unknown): RemoteResult<RemoteConnection> => {
    const result = run(() =>
      getRemoteConnectionStore().approve(text(clientId), Array.isArray(scopes) ? scopes : [], typeof label === 'string' ? label : undefined)
    )
    if (result.ok) notify({ reason: 'list' })
    return result
  })

  ipcMain.handle('mcp:remote:update', (_event, clientId: unknown, change: unknown): RemoteResult<RemoteConnection> => {
    const c = (change ?? {}) as { scopes?: unknown; label?: unknown }
    const result = run(() =>
      getRemoteConnectionStore().update(text(clientId), {
        ...(Array.isArray(c.scopes) ? { scopes: c.scopes } : {}),
        ...(typeof c.label === 'string' ? { label: c.label } : {})
      })
    )
    if (result.ok) notify({ reason: 'list' })
    return result
  })

  ipcMain.handle('mcp:remote:deny', (_event, clientId: unknown) => forget(text(clientId), (s) => s.deny(text(clientId))))

  ipcMain.handle('mcp:remote:remove', (_event, clientId: unknown) => forget(text(clientId), (s) => s.remove(text(clientId))))
}

/**
 * Start answering relayed calls (after the renderer is ready, like the
 * socket server: every tool needs it), and dial out if Remote access is on.
 */
export async function startRelay(options: { window: BrowserWindow; invokeTool: McpToolInvoker; version: string }): Promise<void> {
  window = options.window
  if (IS_MAS_BUILD || relay) return
  const share = await import('../share/index')
  const s = getRemoteConnectionStore()
  calls = new RelayCallHandler({
    store: s,
    invokeTool: options.invokeTool,
    version: options.version,
    onPending: (connection) => notify({ reason: 'pending', clientName: connection.clientName })
  })
  const handler = calls
  relay = new RelayClient({
    isMas: IS_MAS_BUILD,
    endpoint: () => share.relayEndpoint(s.deviceId),
    sessionValid: () => share.sessionValid(),
    handleCall: async (raw) => {
      const frame = parseCallFrame(raw)
      if (!frame) {
        const id = (raw as { id?: unknown } | null)?.id
        return typeof id === 'string' && id.length <= 100 ? { id, answer: { error: { code: -32600, message: 'Invalid call' } } } : null
      }
      return { id: frame.id, answer: await handler.handle(frame) }
    },
    onStatus: (next) => {
      console.log(`[MCP relay] ${next.state}${next.error ? ` (${next.error})` : ''}`)
      notify({ reason: 'status' })
    }
  })
  unsubscribeSession = share.onGatewaySessionChange(() => {
    relay?.refresh()
    notify({ reason: 'status' })
  })
  if (s.enabled) relay.start()
}

/** A Prose window gained focus. */
export function relayMarkActive(): void {
  relay?.markActive()
}

/** On quit: close the socket (Remote access stays as the writer left it) and save last-use times. */
export async function stopRelay(): Promise<void> {
  relay?.stop()
  relay = null
  unsubscribeSession?.()
  unsubscribeSession = null
  await calls?.close()
  calls = null
  try {
    store?.flush()
  } catch (err) {
    console.warn('[MCP relay] Could not save last-use times:', err)
  }
}

