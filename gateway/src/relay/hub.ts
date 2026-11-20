/**
 * relay/hub.ts — the live desktop sockets and the calls in flight (#1238,
 * design §4). Everything here is in memory: a call exists only while a
 * remote client waits on it, and nothing is queued for a desktop that isn't
 * connected. A gateway restart drops every socket; desktops reconnect.
 *
 * One socket per account + device; a newer one from the same device replaces
 * the older. A call goes to the account's most recently active socket (its
 * connect, or an `{type:'active'}` frame), never to another account's: the
 * map is keyed by the account the socket's session belongs to, and `call()`
 * only ever looks under the token's account.
 *
 * Frames are JSON text:
 *   gateway → desktop  {type:'hello', heartbeatS}
 *                      {type:'routing', active}   whether calls come to this socket
 *                      {type:'ping'}
 *                      {type:'call', id, client:{id,name,verified}, scopes, method, params?, headers}
 *   desktop → gateway  {type:'pong'} | {type:'active'}
 *                      {type:'result', id, result} | {type:'result', id, error:{code,message}}
 * A result is accepted only from the socket its call was sent to.
 *
 * Single-instance by design (Render runs one); a second instance would need a
 * pub/sub hop between instances (§4 "Scaling").
 */
import { randomUUID } from 'node:crypto'

/** Heartbeat cadence, and how long a silent socket lives. */
export const HEARTBEAT_MS = 25_000
export const SILENT_CLOSE_MS = 60_000
/** Largest result a desktop may send (§4 payload caps). */
export const MAX_RESULT_BYTES = 10 * 1024 * 1024
/** The socket's frame cap: a result plus its envelope. Beyond it the socket closes (1009). */
export const MAX_FRAME_BYTES = MAX_RESULT_BYTES + 64 * 1024

/** Close codes the desktop can act on. */
export const CLOSE_REPLACED = 4000
export const CLOSE_SILENT = 4001
export const CLOSE_PROTOCOL = 4002

/** JSON-RPC error codes the relay answers with (server-defined range). */
export const RELAY_ERROR = {
  NOT_RUNNING: -32001,
  TIMEOUT: -32002,
  TOO_LARGE: -32003,
  DISCONNECTED: -32004,
} as const

export const NOT_RUNNING_MESSAGE =
  'Prose is not running. Open Prose on your Mac, with Remote access on in Settings → Integrations → Connections, then try again.'

/** The transport a hub needs from a socket (the WebSocket in production, a fake in tests). */
export interface RelaySocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface RelayClient {
  id: string
  name: string
  verified: boolean
}

export interface CallRequest {
  client: RelayClient
  scopes: string[]
  method: string
  params?: unknown
  headers: Record<string, string>
}

export type CallOutcome =
  | { kind: 'result'; result: unknown; bytes: number }
  | { kind: 'error'; error: { code: number; message: string }; bytes: number; reason: 'desktop' | 'timeout' | 'too_large' | 'disconnected' }
  | { kind: 'not_running' }

interface Pending {
  resolve: (outcome: CallOutcome) => void
  timer: NodeJS.Timeout
}

export class RelayDevice {
  readonly connectedAt = Date.now()
  lastActiveAt = this.connectedAt
  lastSeenAt = this.connectedAt
  readonly pending = new Map<string, Pending>()
  /** The `active` this socket was last told (`routing` frames go out only on a change). */
  announcedActive: boolean | null = null
  constructor(
    readonly userId: string,
    readonly deviceId: string,
    readonly socket: RelaySocket
  ) {}
}

function failure(code: number, message: string, reason: 'timeout' | 'too_large' | 'disconnected', bytes = 0): CallOutcome {
  return { kind: 'error', error: { code, message }, bytes, reason }
}

/** A desktop's error object, reduced to {code, message}. */
function cleanError(raw: unknown): { code: number; message: string } {
  const e = (raw ?? {}) as { code?: unknown; message?: unknown }
  const code = Number.isInteger(e.code) ? (e.code as number) : -32603
  const message = typeof e.message === 'string' ? e.message.slice(0, 2000) : 'Prose could not complete the request.'
  return { code, message }
}

export class RelayHub {
  private readonly byUser = new Map<string, Map<string, RelayDevice>>()
  private timer: NodeJS.Timeout | null = null

  /** Register a socket; a live socket from the same account + device is replaced. */
  attach(userId: string, deviceId: string, socket: RelaySocket): RelayDevice {
    let devices = this.byUser.get(userId)
    if (!devices) {
      devices = new Map()
      this.byUser.set(userId, devices)
    }
    const previous = devices.get(deviceId)
    const device = new RelayDevice(userId, deviceId, socket)
    devices.set(deviceId, device)
    if (previous) {
      this.failPending(previous, 'Prose reconnected while this call was in flight. Try again.')
      try {
        previous.socket.close(CLOSE_REPLACED, 'replaced by a newer connection from this device')
      } catch {
        /* already closed */
      }
    }
    socket.send(JSON.stringify({ type: 'hello', heartbeatS: HEARTBEAT_MS / 1000 }))
    this.announce(userId)
    return device
  }

  /**
   * Tell each of an account's sockets whether calls now come to it, so the
   * desktop can show "Receiving remote calls" or "Another Mac is active".
   */
  private announce(userId: string): void {
    const live = this.liveDevice(userId)
    for (const device of this.byUser.get(userId)?.values() ?? []) {
      const active = device === live
      if (device.announcedActive === active) continue
      device.announcedActive = active
      try {
        device.socket.send(JSON.stringify({ type: 'routing', active }))
      } catch {
        /* the close handler detaches it */
      }
    }
  }

  /** The socket closed. Its calls fail now; a replaced socket leaves its successor alone. */
  detach(device: RelayDevice, closeCode?: number): void {
    const devices = this.byUser.get(device.userId)
    if (devices?.get(device.deviceId) === device) {
      devices.delete(device.deviceId)
      if (devices.size === 0) this.byUser.delete(device.userId)
      else this.announce(device.userId)
    }
    if (closeCode === 1009) {
      for (const [id, p] of device.pending) {
        clearTimeout(p.timer)
        device.pending.delete(id)
        p.resolve(failure(RELAY_ERROR.TOO_LARGE, "Prose's answer was larger than the relay's 10 MiB limit.", 'too_large'))
      }
      return
    }
    this.failPending(device, 'Prose disconnected before it answered. Try again.')
  }

  private failPending(device: RelayDevice, message: string): void {
    for (const [id, p] of device.pending) {
      clearTimeout(p.timer)
      device.pending.delete(id)
      p.resolve(failure(RELAY_ERROR.DISCONNECTED, message, 'disconnected'))
    }
  }

  /** A frame from a desktop. Malformed frames are dropped; they never reach a client. */
  receive(device: RelayDevice, raw: string): void {
    device.lastSeenAt = Date.now()
    const bytes = Buffer.byteLength(raw)
    let frame: { type?: unknown; id?: unknown; result?: unknown; error?: unknown }
    try {
      frame = JSON.parse(raw)
    } catch {
      return
    }
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'active') {
      device.lastActiveAt = Date.now()
      this.announce(device.userId)
      return
    }
    if (frame.type !== 'result' || typeof frame.id !== 'string') return
    const pending = device.pending.get(frame.id)
    if (!pending) return // not this socket's call (or already answered / timed out)
    device.pending.delete(frame.id)
    clearTimeout(pending.timer)
    if (bytes > MAX_RESULT_BYTES) {
      pending.resolve(failure(RELAY_ERROR.TOO_LARGE, "Prose's answer was larger than the relay's 10 MiB limit.", 'too_large', bytes))
      return
    }
    if (frame.error !== undefined) {
      pending.resolve({ kind: 'error', error: cleanError(frame.error), bytes, reason: 'desktop' })
      return
    }
    pending.resolve({ kind: 'result', result: frame.result ?? null, bytes })
  }

  /** The account's most recently active socket, if any. */
  liveDevice(userId: string): RelayDevice | undefined {
    let best: RelayDevice | undefined
    for (const device of this.byUser.get(userId)?.values() ?? []) {
      // Ties go to the later socket (the map keeps connection order).
      if (!best || device.lastActiveAt >= best.lastActiveAt) best = device
    }
    return best
  }

  /** Forward one call to the account's live desktop and wait for its answer. */
  call(userId: string, request: CallRequest, timeoutMs: number): Promise<CallOutcome> {
    const device = this.liveDevice(userId)
    if (!device) return Promise.resolve({ kind: 'not_running' })
    const id = randomUUID()
    return new Promise<CallOutcome>((resolve) => {
      const timer = setTimeout(() => {
        device.pending.delete(id)
        resolve(failure(RELAY_ERROR.TIMEOUT, `Prose didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`, 'timeout'))
      }, timeoutMs)
      device.pending.set(id, { resolve, timer })
      try {
        device.socket.send(JSON.stringify({ type: 'call', id, ...request }))
      } catch {
        clearTimeout(timer)
        device.pending.delete(id)
        resolve(failure(RELAY_ERROR.DISCONNECTED, 'Prose disconnected before it answered. Try again.', 'disconnected'))
      }
    })
  }

  /** One heartbeat tick: ping every socket, close the ones silent too long. */
  tick(now = Date.now()): void {
    for (const devices of this.byUser.values()) {
      for (const device of devices.values()) {
        if (now - device.lastSeenAt > SILENT_CLOSE_MS) {
          try {
            device.socket.close(CLOSE_SILENT, 'no heartbeat')
          } catch {
            /* already closed */
          }
          this.detach(device)
          continue
        }
        try {
          device.socket.send('{"type":"ping"}')
        } catch {
          /* the close handler detaches it */
        }
      }
    }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), HEARTBEAT_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Live sockets (for logs). */
  get size(): number {
    let n = 0
    for (const devices of this.byUser.values()) n += devices.size
    return n
  }
}

/** The gateway's one hub. */
export const relayHub = new RelayHub()
