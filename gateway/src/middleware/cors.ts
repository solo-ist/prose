/**
 * cors.ts — reflect only allowlisted origins (localhost + prose.solo.ist).
 * Never a wildcard: cookie-authed endpoints require a concrete origin + credentials.
 */
import { cors } from 'hono/cors'
import { corsOrigins } from '../config.js'

export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return null // non-browser (curl) — no CORS header needed
    if (corsOrigins.includes(origin)) return origin
    // Any localhost port in dev.
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return origin
    }
    return null // reject unknown origins
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-stream-id'],
  credentials: true,
})
