/**
 * The renderer's Sentry client follows the Error Reporting setting at once
 * (#1366): off switches the client off, on switches the same client back on,
 * and an opt-out that arrives while the SDK is still loading wins.
 *
 * The mock keeps the two SDK behaviours the module depends on
 * (@sentry/electron 7.20.1, @sentry/core 10.75.0): `init` makes a client the
 * first time and ignores every later call in the same window, and the client
 * sends only while its `enabled` option is not false.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface FakeClient {
  options: { enabled?: boolean }
  getOptions(): { enabled?: boolean }
}

let client: FakeClient | undefined
/** What would leave the renderer: one entry per event an enabled client took. */
let sent: unknown[] = []

const sdk = {
  init: vi.fn(() => {
    if (client) return
    const options: { enabled?: boolean } = {}
    client = { options, getOptions: () => options }
  }),
  getClient: vi.fn(() => client),
  captureException: vi.fn((error: unknown) => {
    if (client && client.options.enabled !== false) sent.push(error)
  })
}

vi.mock('@sentry/electron/renderer', () => sdk)

async function load() {
  vi.resetModules()
  return import('./sentry')
}

/** An error the SDK's own global handlers pick up, bypassing our wrapper. */
function uncaught(error: unknown) {
  sdk.captureException(error)
}

beforeEach(() => {
  vi.clearAllMocks()
  client = undefined
  sent = []
})

describe('renderer Sentry opt-out', () => {
  it('never loads the client while reporting is off', async () => {
    const sentry = await load()
    await sentry.initRendererSentry(false)
    sentry.captureException(new Error('x'))
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('sends nothing once reporting is switched off', async () => {
    const sentry = await load()
    await sentry.initRendererSentry(true)
    expect(sdk.init).toHaveBeenCalledTimes(1)

    await sentry.setRendererSentryEnabled(false)
    sentry.captureException(new Error('through the wrapper'))
    uncaught(new Error('through the global handlers'))
    expect(sent).toEqual([])
  })

  it('reports again when reporting is switched back on', async () => {
    const sentry = await load()
    await sentry.initRendererSentry(true)
    await sentry.setRendererSentryEnabled(false)
    await sentry.setRendererSentryEnabled(true)
    // The SDK ignores a second `init`, so the module must not rely on one.
    expect(sdk.init).toHaveBeenCalledTimes(1)

    const wrapped = new Error('through the wrapper')
    const global = new Error('through the global handlers')
    sentry.captureException(wrapped)
    uncaught(global)
    expect(sent).toEqual([wrapped, global])
  })

  it('follows the setting through several switches', async () => {
    const sentry = await load()
    await sentry.initRendererSentry(true)
    for (let i = 0; i < 3; i++) {
      await sentry.setRendererSentryEnabled(false)
      uncaught(new Error('off'))
      expect(sent).toEqual([])
      await sentry.setRendererSentryEnabled(true)
    }
    const error = new Error('on')
    uncaught(error)
    expect(sent).toEqual([error])
  })

  it('stays off when the opt-out arrives while the SDK loads', async () => {
    const sentry = await load()
    const starting = sentry.initRendererSentry(true)
    await sentry.setRendererSentryEnabled(false)
    await starting
    expect(sdk.init).not.toHaveBeenCalled()
    expect(client).toBeUndefined()
  })

  it('does not start twice', async () => {
    const sentry = await load()
    await Promise.all([sentry.initRendererSentry(true), sentry.initRendererSentry(true)])
    expect(sdk.init).toHaveBeenCalledTimes(1)
  })
})
