/**
 * auth/oauth.ts — the gateway as an OAuth 2.1 authorization server for one
 * protected resource, the MCP relay (`<gateway>/mcp`, #1238; design
 * docs/architecture/mcp-relay.md §3). Better Auth's own plugins do the
 * protocol and the token handling; nothing here mints or verifies a token by
 * hand.
 *
 *   - `@better-auth/oauth-provider`: authorize / token / register / revoke,
 *     PKCE (S256 only), RFC 8707 resource binding, consent records.
 *   - `@better-auth/cimd`: Client ID Metadata Documents (the client_id is an
 *     https URL on the client's own domain; ChatGPT prefers it). Open DCR is
 *     on too, for clients that only register; app.ts rate-limits it per IP.
 *
 * Access tokens are OPAQUE (`disableJwtPlugin`), stored hashed, and checked
 * against the database on every relayed call (`verifyRelayAccessToken`
 * below), so revoking a client ends its tokens at once. A JWT would stay
 * valid until it expired. With no JWT plugin there are no signing keys: the
 * signed authorization query and the (encrypted) client secrets use
 * BETTER_AUTH_SECRET.
 */
import { getOAuthProviderApi, oauthProvider, type ClientMetadataResourceFetch } from '@better-auth/oauth-provider'
import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { createAuthEndpoint, isAPIError } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import * as z from 'zod'
import { config, mcpResourceUrl } from '../config.js'
import { RELAY_SCOPES } from '../relay/scopes.js'

/** The writer signs in here (email code) when an authorize request finds no session. */
export const OAUTH_SIGN_IN_PATH = '/oauth/sign-in'
/** The writer approves (or denies) a client here. The first of the relay's two gates. */
export const OAUTH_CONSENT_PATH = '/oauth/consent'

/** Scopes the authorization server knows: the relay's three, plus refresh tokens. */
export const OAUTH_SCOPES = [...RELAY_SCOPES, 'offline_access']

const ACCESS_TOKEN_TTL_S = 60 * 60
const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60

/**
 * Test-only CIMD transport (CIMD_TEST_ORIGIN, refused outside development by
 * config.ts): https://<host>/<path> is fetched from <origin>/<host>/<path>.
 * Production uses the plugin's Node transport: one DNS resolution, public
 * addresses only, the connection pinned to it, no redirects followed.
 */
function cimdTransport(): ClientMetadataResourceFetch {
  const origin = config.CIMD_TEST_ORIGIN
  if (!origin) return fetchClientMetadataResource
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    return fetch(new URL(`/${url.host}${url.pathname}`, origin), init)
  }
}

const provider = oauthProvider({
  loginPage: OAUTH_SIGN_IN_PATH,
  consentPage: OAUTH_CONSENT_PATH,
  scopes: OAUTH_SCOPES,
  // A relayed call is routed to the token's account, so every grant needs a
  // user: no client_credentials.
  grantTypes: ['authorization_code', 'refresh_token'],
  disableJwtPlugin: true,
  storeTokens: 'hashed',
  accessTokenExpiresIn: ACCESS_TOKEN_TTL_S,
  refreshTokenExpiresIn: REFRESH_TOKEN_TTL_S,
  // Refresh tokens rotate on use. A retried refresh within 30 s gets the same
  // answer instead of tripping replay detection (the MCP preset's default).
  refreshTokenReuseInterval: 30,
  resources: [{ identifier: mcpResourceUrl, name: 'Prose', allowedScopes: OAUTH_SCOPES }],
  // Every registered client is linked to the one resource; enforcement of
  // per-client resources stays on (the plugin's default).
  clientRegistrationDefaultResources: [mcpResourceUrl],
  enforcePerClientResources: true,
  // DCR, open (no session or initial access token): MCP clients register
  // before anyone signs in. Rate-limited per IP in app.ts.
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  clientRegistrationRequirePKCE: true,
})

/**
 * The relay's token check, as a server-only endpoint (never on the HTTP
 * router) so the `/mcp` route can run the plugin's validator outside a Better
 * Auth request. Answers the RFC 7662 introspection shape; an unknown, expired
 * or revoked token, or one whose client is gone, is `{ active: false }`.
 */
function relayTokenPlugin() {
  return {
    id: 'prose-relay',
    endpoints: {
      verifyRelayAccessToken: createAuthEndpoint.serverOnly(
        { method: 'POST', body: z.object({ token: z.string().min(1).max(4096) }) },
        async (ctx) => {
          try {
            const payload = await getOAuthProviderApi(ctx, provider.options).validateAccessToken(ctx.body.token)
            return { payload: payload as Record<string, unknown> }
          } catch (err) {
            // The plugin answers an unknown token with an APIError; anything
            // else (a database error) is an outage and propagates.
            if (isAPIError(err)) return { payload: { active: false } as Record<string, unknown> }
            throw err
          }
        }
      ),
    },
  } satisfies BetterAuthPlugin
}

export const oauthPlugins = [
  provider,
  cimd({
    fetchClientMetadataResource: cimdTransport(),
    // MCP 2026-07-28 pins CIMD draft-00: client_name and redirect_uris required.
    metadataProfile: 'mcp-2026-07-28',
    onClientCreated: ({ client }) => {
      console.log(`[relay] client registered via CIMD: ${client.clientId}`)
    },
  }),
  relayTokenPlugin(),
] as const
