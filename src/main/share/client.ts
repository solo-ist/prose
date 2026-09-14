/**
 * share/client.ts — the desktop's HTTP client for the gateway share service
 * (#768). Runs in the main process (Node fetch — no CORS wall).
 *
 * Auth (interim, pre-#766): a Better Auth session cookie obtained through the
 * paste-the-magic-link flow (requestSignIn → user retrieves the link →
 * completeSignIn). The cookie is stored in credentialStore under
 * 'gateway-session' — never in settings.json or share-sync.json.
 */
import { credentialStore } from '../credentialStore'

const SESSION_KEY = 'gateway-session'

export interface ShareClientConfig {
  /** Gateway origin, e.g. https://prose-gateway.onrender.com or http://localhost:4000 */
  baseUrl: string
}

export interface PublishResult {
  publicationId: string
  shareUrl: string
  publishRev: string
  revCount: number
}

export interface PulledShareComment {
  id: string
  parentId: string | null
  markedText: string
  occurrenceIndex: number
  commentText: string
  authorName: string
  /** Row was pushed by the publication's author (reply/live conversation). */
  fromAuthor: boolean
  /** Author-controlled resolution; the desktop pull ignores it (local state wins). */
  resolvedAt: string | null
  publishRev: string
  createdAt: string
}

export class ShareClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message)
  }
}

function base(config: ShareClientConfig): string {
  return config.baseUrl.replace(/\/$/, '')
}

/**
 * The stored session is BOUND to the gateway origin it was minted by
 * (independent security audit, M-01): a global cookie would follow any
 * later-configured gateway, handing an attacker-controlled or cleartext
 * host a replayable credential for the original one. Stored as JSON
 * {origin, cookie}; a legacy bare-cookie record predates binding and is
 * refused (one re-sign-in).
 */
interface StoredSession {
  origin: string
  cookie: string
}

async function storedSession(): Promise<StoredSession | null> {
  const raw = await credentialStore.get(SESSION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredSession
    if (typeof parsed?.origin === 'string' && typeof parsed?.cookie === 'string') return parsed
  } catch {
    // Legacy bare cookie — unbound, refuse below.
  }
  return null
}

async function authedHeaders(config: ShareClientConfig): Promise<Record<string, string>> {
  const session = await storedSession()
  if (!session) throw new ShareClientError('Not signed in to the gateway', 401, 'no_session')
  if (session.origin !== new URL(base(config)).origin) {
    throw new ShareClientError(
      `Signed in to ${session.origin}, not this gateway — sign in again here.`,
      401,
      'origin_mismatch'
    )
  }
  return { 'Content-Type': 'application/json', Cookie: session.cookie }
}

async function toError(res: Response): Promise<ShareClientError> {
  let code = 'request_failed'
  try {
    const body = (await res.json()) as { error?: string }
    if (typeof body.error === 'string') code = body.error
  } catch {
    // non-JSON error body
  }
  const messages: Record<string, string> = {
    no_session: 'Not signed in to the gateway.',
    Unauthorized: 'Gateway session expired — sign in again.',
    forbidden: 'This account has no share_publish access yet.',
    rate_limited: 'Rate limited — try again in a minute.',
    revoked: 'This share has been revoked.',
    body_too_large: 'Document too large to publish (8 MB limit).',
  }
  return new ShareClientError(messages[code] ?? `Gateway error (${res.status})`, res.status, code)
}

/** Step 1 of the interim sign-in: ask the gateway to issue a magic link. */
export async function requestSignIn(config: ShareClientConfig, email: string): Promise<void> {
  const res = await fetch(`${base(config)}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base(config) },
    body: JSON.stringify({ email, callbackURL: '/health' }),
  })
  if (!res.ok) throw await toError(res)
}

/**
 * Step 2: the user pastes the magic-link URL (from the gateway log/email).
 * Fetching it completes verification; the Set-Cookie session is captured into
 * credentialStore. The URL must belong to the configured gateway.
 */
export async function completeSignIn(config: ShareClientConfig, magicUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(magicUrl.trim())
  } catch {
    throw new ShareClientError('That does not look like a URL.', 400, 'invalid_link')
  }
  if (parsed.origin !== new URL(base(config)).origin) {
    throw new ShareClientError('That link belongs to a different gateway.', 400, 'wrong_origin')
  }
  const res = await fetch(parsed.toString(), { redirect: 'manual' })
  const setCookies = res.headers.getSetCookie?.() ?? []
  const sessionCookie = setCookies
    .map((c) => c.split(';')[0])
    .filter((c) => c.includes('session_token'))
    .join('; ')
  if (!sessionCookie) {
    throw new ShareClientError('The link did not produce a session (expired?). Request a new one.', 401, 'no_cookie')
  }
  await credentialStore.set(
    SESSION_KEY,
    JSON.stringify({ origin: new URL(base(config)).origin, cookie: sessionCookie } satisfies StoredSession)
  )
}

/**
 * Revoke server-side FIRST (audit M-01: deleting only the local copy left a
 * stolen session live until expiry), then delete locally even if the network
 * call failed — signing out locally is the user's intent regardless.
 */
export async function signOut(config: ShareClientConfig): Promise<void> {
  const session = await storedSession()
  if (session && session.origin === new URL(base(config)).origin) {
    try {
      await fetch(`${base(config)}/api/auth/sign-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.cookie, Origin: base(config) },
      })
    } catch {
      // Gateway unreachable — local deletion still proceeds.
    }
  }
  await credentialStore.delete(SESSION_KEY)
}

/** True when a session cookie exists for THIS gateway AND it accepts it. */
export async function checkSession(config: ShareClientConfig): Promise<{ signedIn: boolean; email?: string }> {
  const session = await storedSession()
  if (!session || session.origin !== new URL(base(config)).origin) return { signedIn: false }
  const cookie = session.cookie
  try {
    const res = await fetch(`${base(config)}/api/auth/get-session`, {
      headers: { Cookie: cookie },
    })
    if (!res.ok) return { signedIn: false }
    const body = (await res.json()) as { user?: { email?: string } } | null
    if (!body?.user) return { signedIn: false }
    return { signedIn: true, email: body.user.email }
  } catch {
    return { signedIn: false }
  }
}

export async function publishArtifact(
  config: ShareClientConfig,
  title: string,
  html: string
): Promise<PublishResult> {
  const res = await fetch(`${base(config)}/api/share/publish`, {
    method: 'POST',
    headers: await authedHeaders(config),
    body: JSON.stringify({ title, html }),
  })
  if (!res.ok) throw await toError(res)
  return (await res.json()) as PublishResult
}

export async function republishArtifact(
  config: ShareClientConfig,
  publicationId: string,
  title: string,
  html: string
): Promise<{ publishRev: string; revCount: number }> {
  const res = await fetch(`${base(config)}/api/share/${encodeURIComponent(publicationId)}/publish`, {
    method: 'PUT',
    headers: await authedHeaders(config),
    body: JSON.stringify({ title, html }),
  })
  if (!res.ok) throw await toError(res)
  return (await res.json()) as { publishRev: string; revCount: number }
}

export async function revokePublication(
  config: ShareClientConfig,
  publicationId: string
): Promise<void> {
  const res = await fetch(`${base(config)}/api/share/${encodeURIComponent(publicationId)}`, {
    method: 'DELETE',
    headers: await authedHeaders(config),
  })
  // A 404 is NOT success (audit M-02): it means this gateway/account has no
  // such publication — likely the wrong gateway or account — and treating
  // it as revoked would record a false local tombstone while the original
  // bearer URL stayed live. Already-revoked publications return 204 (the
  // gateway re-stamps the tombstone), so retries stay idempotent.
  if (res.status === 404) {
    throw new ShareClientError(
      'This gateway has no record of that share (wrong gateway or account?) — nothing was revoked.',
      404,
      'not_found_on_gateway'
    )
  }
  if (!res.ok) throw await toError(res)
}

/**
 * Push a new author comment thread into the live conversation (#769).
 * `fromAuthor: false` re-seeds a viewer's thread (revoke→republish
 * migration) — the original name is required by the gateway then.
 */
export async function postAuthorComment(
  config: ShareClientConfig,
  publicationId: string,
  args: { markedText: string; occurrenceIndex: number; text: string; authorName?: string; fromAuthor?: boolean }
): Promise<{ id: string; createdAt: string }> {
  const res = await fetch(`${base(config)}/api/share/${encodeURIComponent(publicationId)}/comments`, {
    method: 'POST',
    headers: await authedHeaders(config),
    body: JSON.stringify({
      commentText: args.text,
      markedText: args.markedText,
      occurrenceIndex: args.occurrenceIndex,
      ...(args.authorName ? { authorName: args.authorName } : {}),
      ...(args.fromAuthor === false ? { fromAuthor: false } : {}),
    }),
  })
  if (!res.ok) throw await toError(res)
  return (await res.json()) as { id: string; createdAt: string }
}

/** Push an author reply into the live conversation (#769). `fromAuthor:
 * false` re-seeds a viewer's reply with its original name (migration). */
export async function postAuthorReply(
  config: ShareClientConfig,
  publicationId: string,
  commentId: string,
  text: string,
  authorName?: string,
  fromAuthor?: boolean
): Promise<{ id: string; createdAt: string }> {
  const res = await fetch(`${base(config)}/api/share/${encodeURIComponent(publicationId)}/comments/${encodeURIComponent(commentId)}/replies`, {
    method: 'POST',
    headers: await authedHeaders(config),
    body: JSON.stringify({
      commentText: text,
      ...(authorName ? { authorName } : {}),
      ...(fromAuthor === false ? { fromAuthor: false } : {}),
    }),
  })
  if (!res.ok) throw await toError(res)
  return (await res.json()) as { id: string; createdAt: string }
}

/** Push author-controlled resolution state (#769). Idempotent PATCH. */
export async function setCommentResolved(
  config: ShareClientConfig,
  publicationId: string,
  commentId: string,
  resolved: boolean
): Promise<void> {
  const res = await fetch(`${base(config)}/api/share/${encodeURIComponent(publicationId)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    headers: await authedHeaders(config),
    body: JSON.stringify({ resolved }),
  })
  if (!res.ok) throw await toError(res)
}

export async function fetchComments(
  config: ShareClientConfig,
  publicationId: string,
  since: string | null
): Promise<{ comments: PulledShareComment[]; nextCursor: string | null }> {
  const url = new URL(`${base(config)}/api/share/${encodeURIComponent(publicationId)}/comments`)
  if (since) url.searchParams.set('since', since)
  const res = await fetch(url.toString(), { headers: await authedHeaders(config) })
  if (!res.ok) throw await toError(res)
  return (await res.json()) as { comments: PulledShareComment[]; nextCursor: string | null }
}
