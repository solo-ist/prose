// @vitest-environment jsdom
/**
 * `SENTRY_DATA_COLLECTION` against the real SDK: after `init`, every category
 * of extra data the client knows about is off. The SDK's defaults are on, so a
 * category added by an upgrade shows up here as collected until it is listed
 * in `sentryPrivacy.ts`.
 */

import { it, expect } from 'vitest'
import * as Sentry from '@sentry/electron/renderer'
import { SENTRY_DATA_COLLECTION } from './sentryPrivacy'

/** True when a resolved setting collects nothing. */
function isOff(value: unknown): boolean {
  if (value === false) return true
  if (Array.isArray(value)) return value.length === 0
  if (value && typeof value === 'object') return Object.values(value).every(isOff)
  return false
}

it('a crash report collects no extra data', () => {
  Sentry.init({
    dsn: 'https://12345@dummy.dsn/12345',
    integrations: [],
    dataCollection: SENTRY_DATA_COLLECTION
  })
  const client = Sentry.getClient()
  if (!client) throw new Error('init made no client')

  // Lines of Prose's own source around a frame: not the writer's data.
  const { frameContextLines: _lines, ...categories } = client.getDataCollectionOptions()
  const collected = Object.entries(categories)
    .filter(([, value]) => !isOff(value))
    .map(([name]) => name)
  expect(collected).toEqual([])
  // The check above must be looking at something.
  expect(Object.keys(categories).length).toBeGreaterThanOrEqual(Object.keys(SENTRY_DATA_COLLECTION).length)
})
