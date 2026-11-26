// @vitest-environment jsdom
/**
 * What `sentry.ts` relies on, checked against the real renderer SDK rather
 * than a mock: `init` makes a client once per window, and that client reads
 * `enabled` on every event.
 */

import { it, expect } from 'vitest'
import * as Sentry from '@sentry/electron/renderer'

it('one client per window, switched by its enabled option', async () => {
  const sent: unknown[] = []
  const transport = () => ({
    send: async (envelope: unknown) => {
      sent.push(envelope)
      return {}
    },
    flush: async () => true
  })
  const options = { dsn: 'https://12345@dummy.dsn/12345', transport, integrations: [] }

  Sentry.init(options)
  const client = Sentry.getClient()
  if (!client) throw new Error('init made no client')

  Sentry.captureException(new Error('on'))
  await client.flush(2000)
  expect(sent).toHaveLength(1)

  client.getOptions().enabled = false
  Sentry.captureException(new Error('off'))
  await client.flush(2000)
  expect(sent).toHaveLength(1)

  // A second init returns early: no new client, and nothing switches back on.
  Sentry.init(options)
  expect(Sentry.getClient()).toBe(client)
  Sentry.captureException(new Error('still off'))
  await client.flush(2000)
  expect(sent).toHaveLength(1)

  client.getOptions().enabled = true
  Sentry.captureException(new Error('on again'))
  await client.flush(2000)
  expect(sent).toHaveLength(2)
})
