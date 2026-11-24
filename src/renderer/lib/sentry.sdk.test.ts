/**
 * The Error Reporting switch against the real renderer SDK (#1366), watched at
 * the transport, the last step before an event leaves the renderer.
 *
 * `sentry.test.ts` mocks the SDK and so can only assume how it behaves. This
 * file holds the assumptions: `init` works once per window, and a client whose
 * `enabled` option is false sends nothing. If an SDK upgrade changes either,
 * this fails.
 */

import { describe, it, expect, vi } from 'vitest'

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('renderer Sentry against the real SDK', () => {
  it('sends nothing while reporting is off, and sends again when it is back on', async () => {
    // `sampleRate` is 0.5: keep every event.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const sentry = await import('./sentry')
    const Sentry = await import('@sentry/electron/renderer')

    await sentry.initRendererSentry(true)
    const client = Sentry.getClient()
    expect(client).toBeDefined()

    const sent: string[] = []
    vi.spyOn(client!.getTransport()!, 'send').mockImplementation(async (envelope) => {
      const event = envelope[1][0][1] as { exception?: { values?: { value?: string }[] } }
      sent.push(event.exception?.values?.[0]?.value ?? '?')
      return {}
    })

    // Straight to the SDK, as its global error handlers do, not through the
    // module's own `captureException`.
    Sentry.captureException(new Error('on'))
    await settle()

    await sentry.setRendererSentryEnabled(false)
    Sentry.captureException(new Error('off'))
    await settle()

    await sentry.setRendererSentryEnabled(true)
    expect(Sentry.getClient()).toBe(client)
    Sentry.captureException(new Error('on again'))
    await settle()

    expect(sent).toEqual(['on', 'on again'])
  })
})
