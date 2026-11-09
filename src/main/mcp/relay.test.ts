// @vitest-environment node
/** The relay socket client (#1239), against a fake WebSocket: dial-out rules, heartbeats, reconnects, the kill switch. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_RESULT_BYTES, RelayClient, type RelayClientOptions, type RelaySocketLike, type RelayStatus } from './relay'

class FakeSocket implements RelaySocketLike {
  readyState = 0
  sent: string[] = []
  closed: { code?: number } | null = null
  onopen: RelaySocketLike['onopen'] = null
  onmessage: RelaySocketLike['onmessage'] = null
  onclose: RelaySocketLike['onclose'] = null
  onerror: RelaySocketLike['onerror'] = null
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>
  ) {}
  send(data: string) {
    this.sent.push(data)
  }
  close(code?: number) {
    this.closed = { code }
    this.readyState = 3
  }
  // The gateway's side:
  open() {
    this.readyState = 1
    this.onopen?.({})
    this.receive({ type: 'hello', heartbeatS: 25 })
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) })
  }
  drop(code: number) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

const ENDPOINT = { url: 'wss://gateway.test/relay?device=dddddddddddddddddddddddd', cookie: 'better-auth.session_token=abc' }
let client: RelayClient | null = null
afterEach(() => {
  client?.stop()
  client = null
  vi.useRealTimers()
})

function setup(overrides: Partial<RelayClientOptions> = {}) {
  const sockets: FakeSocket[] = []
  const statuses: RelayStatus[] = []
  client = new RelayClient({
    isMas: false,
    endpoint: async () => ENDPOINT,
    handleCall: async (frame) => ({ id: (frame as { id: string }).id, answer: { result: { echoed: (frame as { method: string }).method } } }),
    onStatus: (s) => statuses.push(s),
    socketFactory: (url, init) => {
      const s = new FakeSocket(url, init.headers)
      sockets.push(s)
      return s
    },
    timing: { initialBackoffMs: 10, maxBackoffMs: 40, silenceMs: 60 },
    ...overrides
  })
  return { client, sockets, statuses }
}

const until = (cond: () => boolean) => vi.waitFor(() => expect(cond()).toBe(true), { timeout: 2000, interval: 5 })

describe('RelayClient', () => {
  it('dials out with the session cookie and the device, and is connected after hello', async () => {
    const { client, sockets, statuses } = setup()
    client.start()
    await until(() => sockets.length === 1)
    expect(sockets[0].url).toBe(ENDPOINT.url)
    expect(sockets[0].headers).toEqual({ Cookie: ENDPOINT.cookie })
    expect(client.status.state).toBe('connecting')
    sockets[0].open()
    expect(client.status.state).toBe('connected')
    expect(statuses.map((s) => s.state)).toEqual(['connecting', 'connected'])
  })

  it('answers pings, answers calls with their id, and says when the writer is active', async () => {
    const { client, sockets } = setup()
    client.start()
    await until(() => sockets.length === 1)
    sockets[0].open()
    sockets[0].receive({ type: 'ping' })
    expect(sockets[0].sent).toContain('{"type":"pong"}')
    sockets[0].receive({ type: 'call', id: 'call-1', method: 'tools/list' })
    await until(() => sockets[0].sent.some((m) => m.includes('call-1')))
    expect(JSON.parse(sockets[0].sent.find((m) => m.includes('call-1'))!)).toEqual({ type: 'result', id: 'call-1', result: { echoed: 'tools/list' } })
    client.markActive()
    expect(sockets[0].sent.at(-1)).toBe('{"type":"active"}')
    sockets[0].receive('not json')
    sockets[0].receive({ type: 'mystery' })
    expect(client.status.state).toBe('connected')
  })

  it('answers an oversized result with an error instead', async () => {
    const { client, sockets } = setup({
      handleCall: async (frame) => ({ id: (frame as { id: string }).id, answer: { result: { text: 'x'.repeat(MAX_RESULT_BYTES) } } })
    })
    client.start()
    await until(() => sockets.length === 1)
    sockets[0].open()
    sockets[0].receive({ type: 'call', id: 'big', method: 'tools/call' })
    await until(() => sockets[0].sent.some((m) => m.includes('"big"')))
    const reply = JSON.parse(sockets[0].sent.find((m) => m.includes('"big"'))!)
    expect(reply).toMatchObject({ type: 'result', id: 'big', error: { code: -32003 } })
  })

  it('reconnects with backoff after a drop, and after silence', async () => {
    const { client, sockets } = setup()
    client.start()
    await until(() => sockets.length === 1)
    sockets[0].open()
    sockets[0].drop(1006)
    expect(client.status).toMatchObject({ state: 'reconnecting' })
    await until(() => sockets.length === 2)
    sockets[1].open()
    expect(client.status.state).toBe('connected')
    // No frame for longer than the silence limit: the client closes and redials.
    await until(() => sockets[1].closed?.code === 4100)
    sockets[1].drop(4100)
    await until(() => sockets.length === 3)
  })

  it('the kill switch closes at once and nothing redials', async () => {
    const { client, sockets } = setup()
    client.start()
    await until(() => sockets.length === 1)
    sockets[0].open()
    client.stop()
    expect(sockets[0].closed).toEqual({ code: 1000 })
    expect(client.status.state).toBe('off')
    sockets[0].drop(1000)
    await new Promise((r) => setTimeout(r, 60))
    expect(sockets).toHaveLength(1)
  })

  it('stops on replacement (4000) and on an ended session (4003)', async () => {
    const { client, sockets } = setup()
    client.start()
    await until(() => sockets.length === 1)
    sockets[0].open()
    sockets[0].drop(4000)
    expect(client.status.state).toBe('replaced')
    client.refresh()
    await until(() => sockets.length === 2)
    sockets[1].open()
    sockets[1].drop(4003)
    expect(client.status.state).toBe('signed-out')
    await new Promise((r) => setTimeout(r, 60))
    expect(sockets).toHaveLength(2)
  })

  it('signed out: no socket; an upgrade refused for the session stops retrying', async () => {
    const signedOut = setup({ endpoint: async () => null })
    signedOut.client.start()
    await until(() => signedOut.client.status.state === 'signed-out')
    expect(signedOut.sockets).toHaveLength(0)
    signedOut.client.stop()

    const refused = setup({ sessionValid: async () => false })
    refused.client.start()
    await until(() => refused.sockets.length === 1)
    refused.sockets[0].drop(1006) // closed before it ever opened
    await until(() => refused.client.status.state === 'signed-out')
    await new Promise((r) => setTimeout(r, 60))
    expect(refused.sockets).toHaveLength(1)
  })

  it('never dials out in the Mac App Store build', async () => {
    const endpoint = vi.fn(async () => ENDPOINT)
    const { client, sockets } = setup({ isMas: true, endpoint })
    client.start()
    client.refresh()
    await new Promise((r) => setTimeout(r, 30))
    expect(sockets).toHaveLength(0)
    expect(endpoint).not.toHaveBeenCalled()
    expect(client.status.state).toBe('unavailable')
  })
})
