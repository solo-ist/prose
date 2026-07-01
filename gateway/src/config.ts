/**
 * config.ts — single source of truth for the gateway's environment.
 * Parsed + validated with Zod at startup; a hard failure exits non-zero.
 */
import { z } from 'zod'

const EnvSchema = z.object({
  // Render (and most PaaS) inject PORT; prefer it, else GATEWAY_PORT, else 4000.
  PORT: z.coerce.number().optional(),
  GATEWAY_PORT: z.coerce.number().default(4000),
  NODE_ENV: z.string().default('development'),

  // LLM proxy — the OPERATOR's Anthropic key (gateway-side). Optional locally
  // when UPSTREAM_URL points at the mock; required in prod.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().default('https://api.anthropic.com'),
  UPSTREAM_URL: z.string().optional(), // local mock override, e.g. http://localhost:4001

  // Auth + DB (required once Phase 0 auth lands; optional so the core boots early).
  DATABASE_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.string().default('http://localhost:4000'),

  // CORS allowlist (comma-separated origins).
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:5174,https://prose.solo.ist'),

  // Cloudflare R2 (blobs only; stub in Phase 0).
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
})

export type Env = z.infer<typeof EnvSchema>

function loadConfig(): Env {
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error('[config] Invalid environment:')
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    }
    process.exit(1)
  }
  return parsed.data
}

export const config = loadConfig()

/** Port to bind. Render injects PORT; fall back to GATEWAY_PORT (default 4000). */
export const port = config.PORT ?? config.GATEWAY_PORT

/** Allowlisted CORS origins, trimmed. */
export const corsOrigins = config.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** The upstream LLM base URL — the mock override wins for local testing. */
export const upstreamBase = config.UPSTREAM_URL ?? config.ANTHROPIC_BASE_URL

/** True when we're proxying the real Anthropic API (key present, no mock override). */
export const useRealAnthropic = !config.UPSTREAM_URL && !!config.ANTHROPIC_API_KEY
