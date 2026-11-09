/**
 * test-relay-hub.ts — unit checks for the relay hub's timers (#1238): the
 * parts test-relay.mjs can't reach in real time (a 25 s heartbeat, a 60 s
 * silence). Drives RelayHub.tick() with a fake clock and fake sockets.
 *
 * Usage: npx tsx scripts/test-relay-hub.ts (part of npm run test:relay)
 */
import { CLOSE_SILENT, HEARTBEAT_MS, RelayHub, SILENT_CLOSE_MS, type RelaySocket } from '../src/relay/hub.js'

let passed = 0
let failed = 0
const expect = (cond: boolean, label: string, detail?: string) => {
  if (cond) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`)
    failed++
  }
}

function fakeSocket() {
  const sent: string[] = []
  const state = { sent, closed: null as number | null }
  const socket: RelaySocket = {
    send: (d) => {
      if (state.closed !== null) throw new Error('closed')
      sent.push(d)
    },
    close: (code) => {
      state.closed = code ?? 1000
    },
  }
  return { socket, state }
}

const hub = new RelayHub()
const a = fakeSocket()
const device = hub.attach('user-a', 'device-aaaaaaaaaaaa', a.socket)
expect(JSON.parse(a.state.sent[0]).type === 'hello' && JSON.parse(a.state.sent[0]).heartbeatS === HEARTBEAT_MS / 1000, 'a new socket is greeted with the heartbeat cadence')

const t0 = device.lastSeenAt
hub.tick(t0 + HEARTBEAT_MS)
expect(a.state.sent.at(-1) === '{"type":"ping"}', 'each tick pings the socket')

hub.receive(device, '{"type":"pong"}')
const seen = device.lastSeenAt
hub.tick(seen + SILENT_CLOSE_MS - 1000)
expect(a.state.closed === null && hub.size === 1, 'a socket heard from within 60 s stays open')

const pending = hub.call('user-a', { client: { id: 'c', name: 'C', verified: false }, scopes: ['read'], method: 'ping', headers: {} }, 30_000)
hub.tick(seen + SILENT_CLOSE_MS + 1000)
expect(a.state.closed === CLOSE_SILENT, 'a socket silent for over 60 s is closed (4001)', String(a.state.closed))
expect(hub.size === 0 && hub.liveDevice('user-a') === undefined, 'and leaves the hub')
const outcome = await pending
expect(outcome.kind === 'error' && outcome.reason === 'disconnected', 'its call in flight fails at once', JSON.stringify(outcome))

const notRunning = await hub.call('user-a', { client: { id: 'c', name: 'C', verified: false }, scopes: ['read'], method: 'ping', headers: {} }, 30_000)
expect(notRunning.kind === 'not_running', 'with no socket, a call is "not running" and nothing queues')

const b = fakeSocket()
const deviceB = hub.attach('user-b', 'device-bbbbbbbbbbbb', b.socket)
hub.receive(deviceB, 'not json')
hub.receive(deviceB, '{"type":"result","id":"nobody-asked"}')
expect(b.state.closed === null && hub.size === 1, 'malformed and unsolicited frames are dropped, the socket kept')

hub.stop()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
