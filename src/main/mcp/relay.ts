/**
 * The relay socket (#1239; design docs/architecture/mcp-relay.md §2, §4, §6):
 * the outbound WebSocket the signed-in desktop opens to the gateway, over
 * which remote MCP clients' calls arrive. The writer's machine opens no port.
 *
 * Off until the writer turns on Remote access; turning it off closes the
 * socket at once (the kill switch), and the gateway then tells remote clients
 * "Prose is not running". The Mac App Store build never dials out.
 *
 * Node's built-in WebSocket (Electron's Node) carries the gateway session
 * cookie on the upgrade and sends no Origin header, which the gateway
 * requires (a browser page always sends one).
 */

import type { RelayAnswer } from './relayCalls'
import type { RelayState } from '../../shared/mcp/remoteAccess'

export type { RelayState }

export interface RelayStatus {
  state: RelayState
  error?: string
}

export interface RelayEndpoint {
  /** ws(s)://<gateway>/relay?device=<id> */
  url: string
  /** The gateway session cookie (`name=value`). */
  cookie: string
}

/** The subset of the WebSocket API the client uses (a fake in tests). */
export interface RelaySocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number; reason?: string }) => void) | null
  onerror: ((event: unknown) => void) | null
}

export type RelaySocketFactory = (url: string, init: { headers: Record<string, string> }) => RelaySocketLike

export interface RelayClientOptions {
  /** The Mac App Store build: never dial out. */
  isMas: boolean
  /** Where to connect and with which session, or null when signed out. */
  endpoint: () => Promise<RelayEndpoint | null>
  /** After an upgrade that never opened: is the session still good? False stops retrying (signed out). */
  sessionValid?: () => Promise<boolean>
  /** Answer one call frame (raw, from the network). Null drops it. */
  handleCall: (frame: unknown) => Promise<{ id: string; answer: RelayAnswer } | null>
  onStatus?: (status: RelayStatus) => void
  socketFactory?: RelaySocketFactory
  /** Reconnect backoff and the silence that counts as a dead socket (tests shorten them). */
  timing?: { initialBackoffMs?: number; maxBackoffMs?: number; silenceMs?: number }
}

/** Results larger than this are answered with an error (the gateway's cap, §4). */
export const MAX_RESULT_BYTES = 10 * 1024 * 1024
/** The gateway closes a replaced socket with 4000 and an ended session with 4003. */
const CLOSE_REPLACED = 4000
const CLOSE_SESSION_ENDED = 4003
const CLOSE_SILENT = 4100
const OPEN = 1

const defaultSocketFactory: RelaySocketFactory = (url, init) =>
  // Node's WebSocket accepts `headers` beside the standard `protocols`.
  new (globalThis.WebSocket as unknown as new (url: string, init: unknown) => RelaySocketLike)(url, init)

export class RelayClient {
  private socket: RelaySocketLike | null = null
  private wanted = false
  /** Bumped by every start/stop, so a connect still awaiting its endpoint can tell it is stale. */
  private generation = 0
  private attempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private silenceTimer: NodeJS.Timeout | null = null
  private lastFrameAt = 0
  private current: RelayStatus = { state: 'off' }
  private readonly initialBackoffMs: number
  private readonly maxBackoffMs: number
  private readonly silenceMs: number
  private readonly socketFactory: RelaySocketFactory

  constructor(private readonly options: RelayClientOptions) {
    this.initialBackoffMs = options.timing?.initialBackoffMs ?? 1000
    this.maxBackoffMs = options.timing?.maxBackoffMs ?? 60_000
    this.silenceMs = options.timing?.silenceMs ?? 75_000
    this.socketFactory = options.socketFactory ?? defaultSocketFactory
  }

  get status(): RelayStatus {
    return { ...this.current }
  }

  /** Remote access on: connect (or reconnect with the current session). */
  start(): void {
    if (this.options.isMas) {
      this.setStatus({ state: 'unavailable' })
      return
    }
    this.wanted = true
    this.attempt = 0
    this.generation++
    this.teardown()
    void this.connect()
  }

  /** Remote access off: close at once and stay off. */
  stop(): void {
    this.wanted = false
    this.generation++
    this.teardown()
    this.setStatus({ state: this.options.isMas ? 'unavailable' : 'off' })
  }

  /** The gateway session changed (sign-in or sign-out): reconnect if Remote access is on. */
  refresh(): void {
    if (this.wanted) this.start()
  }

  /** A Prose window gained focus: calls should come here rather than to another desktop. */
  markActive(): void {
    if (this.socket?.readyState === OPEN) this.socket.send('{"type":"active"}')
  }

  private setStatus(status: RelayStatus): void {
    if (status.state === this.current.state && status.error === this.current.error) return
    this.current = status
    this.options.onStatus?.({ ...status })
  }

  private teardown(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.silenceTimer) clearInterval(this.silenceTimer)
    this.reconnectTimer = null
    this.silenceTimer = null
    const socket = this.socket
    this.socket = null
    if (socket) {
      try {
        socket.close(1000, 'Remote access off')
      } catch {
        /* already closed */
      }
    }
  }

  private async connect(): Promise<void> {
    const generation = this.generation
    let endpoint: RelayEndpoint | null
    try {
      endpoint = await this.options.endpoint()
    } catch {
      endpoint = null
    }
    if (!this.wanted || this.socket || generation !== this.generation) return
    if (!endpoint) {
      this.setStatus({ state: 'signed-out' })
      return
    }
    this.setStatus(this.attempt === 0 ? { state: 'connecting' } : { state: 'reconnecting', error: this.current.error })
    let socket: RelaySocketLike
    try {
      socket = this.socketFactory(endpoint.url, { headers: { Cookie: endpoint.cookie } })
    } catch (err) {
      this.retry(err instanceof Error ? err.message : 'Could not open the connection')
      return
    }
    this.socket = socket
    let opened = false
    socket.onopen = () => {
      opened = true
      this.lastFrameAt = Date.now()
      this.silenceTimer = setInterval(() => {
        if (Date.now() - this.lastFrameAt > this.silenceMs && this.socket === socket) {
          socket.close(CLOSE_SILENT, 'no heartbeat')
        }
      }, Math.min(15_000, this.silenceMs))
      this.silenceTimer.unref?.()
    }
    socket.onmessage = (event) => {
      if (this.socket !== socket) return
      this.lastFrameAt = Date.now()
      this.receive(socket, event.data)
    }
    socket.onerror = () => {
      /* the close event follows */
    }
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.silenceTimer) clearInterval(this.silenceTimer)
      this.silenceTimer = null
      if (!this.wanted) return
      if (event.code === CLOSE_REPLACED) {
        this.setStatus({ state: 'replaced' })
        return
      }
      if (event.code === CLOSE_SESSION_ENDED) {
        this.setStatus({ state: 'signed-out' })
        return
      }
      if (!opened && this.options.sessionValid) {
        void this.options.sessionValid().then(
          (valid) => {
            if (!this.wanted || this.socket) return
            if (valid) this.retry('Prose could not reach the gateway')
            else this.setStatus({ state: 'signed-out' })
          },
          () => this.retry('Prose could not reach the gateway')
        )
        return
      }
      this.retry(opened ? 'The connection to the gateway closed' : 'Prose could not reach the gateway')
    }
  }

  private retry(error: string): void {
    if (!this.wanted) return
    const delay = Math.min(this.maxBackoffMs, this.initialBackoffMs * 2 ** this.attempt)
    this.attempt++
    this.setStatus({ state: 'reconnecting', error })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
    this.reconnectTimer.unref?.()
  }

  private receive(socket: RelaySocketLike, data: unknown): void {
    if (typeof data !== 'string') return
    let frame: { type?: unknown }
    try {
      frame = JSON.parse(data)
    } catch {
      return
    }
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'hello') {
      this.attempt = 0
      this.setStatus({ state: 'connected' })
      return
    }
    if (frame.type === 'ping') {
      socket.send('{"type":"pong"}')
      return
    }
    if (frame.type !== 'call') return
    void this.options.handleCall(frame).then(
      (reply) => {
        if (!reply || this.socket !== socket || socket.readyState !== OPEN) return
        let text = JSON.stringify({ type: 'result', id: reply.id, ...reply.answer })
        if (Buffer.byteLength(text) > MAX_RESULT_BYTES) {
          text = JSON.stringify({
            type: 'result',
            id: reply.id,
            error: { code: -32003, message: "Prose's answer is larger than the relay allows (10 MiB). Ask for less." }
          })
        }
        socket.send(text)
      },
      (err) => console.error('[MCP relay] A call failed:', err instanceof Error ? err.message : err)
    )
  }
}
