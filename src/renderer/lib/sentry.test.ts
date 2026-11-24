/**
 * The renderer's Sentry client follows the Error Reporting setting at once
 * (#1366): off closes the client, on starts a new one, and an opt-out that
 * arrives while the SDK is still loading wins.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const close = vi.fn(async () => true)
const sdk = {
  init: vi.fn(),
  getClient: vi.fn(() => ({ close })),
  captureException: vi.fn()
}

vi.mock('@sentry/electron/renderer', () => sdk)

async function load() {
  vi.resetModules()
  return import('./sentry')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('renderer Sentry opt-out', () => {
  it('never loads the client while reporting is off', async () => {
    const sentry = await load()
    await sentry.initRendererSentry(false)
    sentry.captureException(new Error('x'))
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sdk.captureException).not.toHaveBeenCalled()
  })

  it('closes the client when reporting is switched off', async () => {
    const sentry = await load()
    await sentry.initRendererSentry(true)
    expect(sdk.init).toHaveBeenCalledTimes(1)

    await sentry.setRendererSentryEnabled(false)
    expect(close).toHaveBeenCalledTimes(1)

    sentry.captureException(new Error('after opt-out'))
    expect(sdk.captureException).not.toHaveBeenCalled()
  })

  it('starts a new client when reporting is switched back on', async () => {
    const sentry = await load()
    await sentry.initRendererSentry(true)
    await sentry.setRendererSentryEnabled(false)
    await sentry.setRendererSentryEnabled(true)
    expect(sdk.init).toHaveBeenCalledTimes(2)

    sentry.captureException(new Error('reported'))
    expect(sdk.captureException).toHaveBeenCalledTimes(1)
  })

  it('stays off when the opt-out arrives while the SDK loads', async () => {
    const sentry = await load()
    const starting = sentry.initRendererSentry(true)
    await sentry.setRendererSentryEnabled(false)
    await starting
    expect(sdk.init).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('does not start twice', async () => {
    const sentry = await load()
    await Promise.all([sentry.initRendererSentry(true), sentry.initRendererSentry(true)])
    expect(sdk.init).toHaveBeenCalledTimes(1)
  })
})
