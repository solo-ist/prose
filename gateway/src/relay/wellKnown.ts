/**
 * relay/wellKnown.ts — OAuth discovery for the relay (#1238, design §3).
 *
 *   /.well-known/oauth-protected-resource/mcp   RFC 9728, path-inserted for the
 *   /.well-known/oauth-protected-resource       resource (and the bare form, which
 *                                               some clients try first)
 *   /.well-known/oauth-authorization-server/api/auth   RFC 8414 for the issuer
 *   /.well-known/oauth-authorization-server            `<gateway>/api/auth` (and bare)
 *
 * Better Auth serves the issuer-relative form itself under /api/auth; these
 * are the root paths it can't reach. One authorization server is named
 * (Claude reads only the first). Public, read-only documents, so any origin
 * may read them (no credentials).
 */
import { Hono } from 'hono'
import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import { auth } from '../auth/index.js'
import { OAUTH_SCOPES } from '../auth/oauth.js'
import { gatewayOrigin, mcpResourceUrl } from '../config.js'

/** The authorization server's issuer: Better Auth's base URL. */
export const oauthIssuer = `${gatewayOrigin}/api/auth`

const CORS = { 'Access-Control-Allow-Origin': '*' }

export const relayWellKnownRoutes = new Hono()

const protectedResource = () =>
  new Response(
    JSON.stringify({
      resource: mcpResourceUrl,
      authorization_servers: [oauthIssuer],
      scopes_supported: OAUTH_SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'Prose',
    }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', ...CORS } }
  )

relayWellKnownRoutes.get('/.well-known/oauth-protected-resource/mcp', protectedResource)
relayWellKnownRoutes.get('/.well-known/oauth-protected-resource', protectedResource)

const authServerMetadata = oauthProviderAuthServerMetadata(auth, { headers: CORS })
relayWellKnownRoutes.get('/.well-known/oauth-authorization-server/api/auth', (c) => authServerMetadata(c.req.raw))
relayWellKnownRoutes.get('/.well-known/oauth-authorization-server', (c) => authServerMetadata(c.req.raw))
