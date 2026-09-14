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

async function authedHeaders(): Promise<Record<string, string>> {
  const cookie = await credentialStore.get(SESSION_KEY)
  if (!cookie) throw new ShareClientError('Not signed in to the gateway', 401, 'no_session')
  return { 'Content-Type': 'application/json', Cookie: cookie }
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
  await credentialStore.set(SESSION_KEY, sessionCookie)
}

export async function signOut(): Promise<void> {
  await credentialStore.delete(SESSION_KEY)
}

/** True when a session cookie exists AND the gateway accepts it. */
export async function checkSession(config: ShareClientConfig): Promise<{ signedIn: boolean; email?: string }> {
  const cookie = await credentialStore.get(SESSION_KEY)
  if (!cookie) return { signedIn: false }
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
    headers: await authedHeaders(),
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
    headers: await authedHeaders(),
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
    headers: await authedHeaders(),
  })
  if (!res.ok && res.status !== 404) throw await toError(res)
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
    headers: await authedHeaders(),
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
    headers: await authedHeaders(),
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
    headers: await authedHeaders(),
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
  const res = await fetch(url.toString(), { headers: await authedHeaders() })
  if (!res.ok) throw await toError(res)
  return (await res.json()) as { comments: PulledShareComment[]; nextCursor: string | null }
}
