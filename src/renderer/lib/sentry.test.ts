/**
 * The renderer's Sentry client follows the Error Reporting setting at once
 * (#1366): off disables the client, on enables the same client again, and an
 * opt-out that arrives while the SDK is still loading wins.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Like the real renderer SDK, `init` works once per window: a second call
// returns early and makes no client. The client reads `enabled` on every event.
type FakeClient = { options: { enabled?: boolean }; getOptions: () => { enabled?: boolean } }
let client: FakeClient | undefined
const sent: unknown[] = []
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

beforeEach(() => {
  vi.clearAllMocks()
  client = undefined
  sent.length = 0
})

describe('renderer Sentry opt-out', () => {
  it('never loads the client while reporting is off', async () => {
    const sentry = await load()
    await sentry.initRendererSentry(false)
    sentry.captureException(new Error('x'))
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sdk.captureException).not.toHaveBeenCalled()
  })

  it('disables the client when reporting is switched off', async () => {
    const sentry = await load()
    await sentry.initRendererSentry(true)
    expect(sdk.init).toHaveBeenCalledTimes(1)

    await sentry.setRendererSentryEnabled(false)
    // The SDK's own global handlers report through the client, not the wrapper.
    expect(client?.options.enabled).toBe(false)

    sentry.captureException(new Error('after opt-out'))
    expect(sdk.captureException).not.toHaveBeenCalled()
  })

  it('reports again when reporting is switched back on', async () => {
    const sentry = await load()
    await sentry.initRendererSentry(true)
    await sentry.setRendererSentryEnabled(false)
    await sentry.setRendererSentryEnabled(true)
    // One client for the window; a second `init` would do nothing.
    expect(sdk.init).toHaveBeenCalledTimes(1)
    expect(client?.options.enabled).toBe(true)

    const error = new Error('reported')
    sentry.captureException(error)
    expect(sent).toEqual([error])
  })

  it('follows the setting through repeated switches', async () => {
    const sentry = await load()
    await sentry.initRendererSentry(true)
    for (let i = 0; i < 3; i++) {
      await sentry.setRendererSentryEnabled(false)
      expect(client?.options.enabled).toBe(false)
      await sentry.setRendererSentryEnabled(true)
      expect(client?.options.enabled).toBe(true)
    }
    expect(sdk.init).toHaveBeenCalledTimes(1)
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
