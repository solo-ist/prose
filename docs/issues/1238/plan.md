# #1238 — M5a: the remote MCP relay, gateway side (1.9.1 epic #1230)

Design of record: [`docs/architecture/mcp-relay.md`](../../architecture/mcp-relay.md) (branch
`issue-1238-relay-design`), with the operator's §8 decisions final (2026-11-09): any signed-in writer gets Remote
access; CIMD **and** DCR, DCR rate-limited; access tokens 1 h, refresh tokens 30 d; remote clients work only on
documents already open in Prose.

## Context

ChatGPT (web, mobile, Chat mode) and claude.ai (web, mobile, Cowork, Claude Desktop connectors) call MCP servers
from their own clouds: they need a public HTTPS endpoint with OAuth 2.1, and ChatGPT takes no static keys. The
gateway becomes that endpoint and relays each call, in memory, to the writer's signed-in desktop over a WebSocket the
desktop dials out. M5a is the gateway half; M5b (#1239) is the desktop half.

## Packages (confirmed 2026-11-09)

- `@better-auth/oauth-provider@1.7.18` and `@better-auth/cimd@1.7.18`, pinned exactly to the gateway's
  `better-auth@1.7.18` (both declare `better-auth ^1.7.18`, `better-call 1.4.5`, `@better-fetch/fetch 1.3.3`, which
  the gateway already resolves to those versions).
- `ws@8` for the socket server, through `@hono/node-server` 2's built-in `upgradeWebSocket`.
- Not used: `@better-auth/mcp`. Its `mcp()` preset is a thin wrapper over `oauthProvider` whose `requireMcpAuth`
  verifies **JWT** access tokens against the JWKS. A JWT stays valid until it expires, so "a revoked client fails
  at once" would not hold. The gateway instead runs `oauthProvider` with `disableJwtPlugin: true`: access tokens
  are opaque, stored hashed (`storeTokens: 'hashed'`, the default), and checked against the database on every call
  through the plugin's own validator (`getOAuthProviderApi(...).validateAccessToken`). Revocation is a row update,
  effective on the next call. No signing keys exist, so no new secret: the signed authorization query and the
  encrypted client secrets use `BETTER_AUTH_SECRET`.

## Design

1. **Authorization server** (`gateway/src/auth/oauth.ts`, plugged into `auth/index.ts`). Issuer
   `${BETTER_AUTH_URL}/api/auth`; one protected resource, `${BETTER_AUTH_URL}/mcp` (production:
   `https://api.prose.solo.ist/mcp`, the gateway's real host, see "Open" below).
   - Scopes `read`, `propose`, `comment`, plus `offline_access` for refresh tokens. No `openid`: a pure OAuth server.
   - Grants `authorization_code` + `refresh_token` only (no `client_credentials`: a call needs an account to route to).
   - PKCE S256 required (the plugin's default for public clients; `clientRegistrationRequirePKCE` keeps it for
     confidential DCR clients too).
   - Audience: the resource is seeded, linked to every new client (`clientRegistrationDefaultResources`), and
     `enforcePerClientResources` stays on. `/api/auth/oauth2/authorize` without `resource` is refused before the
     plugin sees it (`invalid_target`), so no token without the audience is ever minted; `/mcp` also refuses any
     token whose `aud` doesn't name the resource.
   - Lifetimes: access 3600 s, refresh 30 d (rotated on use; a 30 s reuse window for a retried refresh, as the MCP
     preset does).
   - **CIMD** with `metadataProfile: 'mcp-2026-07-28'` and the plugin's own Node transport
     (`@better-auth/cimd/node`: resolve once, public addresses only, no redirects, size cap, short timeout).
     **DCR** open (`allowDynamicClientRegistration` + `allowUnauthenticatedClientRegistration`), rate-limited per IP.
   - A server-only endpoint (`auth.api.verifyRelayAccessToken`, never on the HTTP router) wraps the plugin's
     validator so the `/mcp` route can call it outside a Better Auth request.
   - Better Auth's own limiter stays off (it can't see client IPs behind Render); app.ts rate-limits the OAuth
     routes with `ipRateLimit` like the sign-in routes.
2. **Schema**: the plugin's tables (`oauthClient`, `oauthResource`, `oauthClientResource`, `oauthRefreshToken`,
   `oauthAccessToken`, `oauthConsent`, `oauthClientAssertion`), generated with the Better Auth CLI and migrated in
   `prisma/migrations/20261109000001_mcp_relay_oauth`. Token columns hold SHA-256 hashes only. Token → session
   foreign keys are `ON DELETE SET NULL`.
3. **Discovery**:
   - `GET /.well-known/oauth-protected-resource/mcp` (and the bare `/.well-known/oauth-protected-resource`): RFC 9728
     `{ resource, authorization_servers: [issuer], scopes_supported, bearer_methods_supported: ['header'] }`.
   - `GET /.well-known/oauth-authorization-server/api/auth` (RFC 8414 path insertion) and the bare
     `/.well-known/oauth-authorization-server`, from the plugin's `oauthProviderAuthServerMetadata` (CIMD adds
     `client_id_metadata_document_supported: true`).
   - Every unauthenticated or invalid-token `/mcp` request: 401 with
     `WWW-Authenticate: Bearer resource_metadata="…", scope="read propose comment offline_access"`.
4. **Sign-in and consent pages** (`gateway/src/relay/pages.ts`): static HTML, scripts allowed by CSP hash (as
   `/auth/code` is), no `innerHTML`.
   - `/oauth/sign-in`: the existing email code (`/api/sign-in/code`, then `/api/auth/sign-in/email-otp` carrying the
     signed `oauth_query`, which the plugin resumes into the authorize step).
   - `/oauth/consent`: server-rendered from the verified signed query (`verifyOAuthQueryParams`) and the session.
     It names the client, says whether it is **verified** (CIMD: its `client_id` is a URL on its own domain) or
     registered itself (DCR), lists the scopes asked for, shows the signed-in email, and says the writer will
     approve the client again in Prose. Allow / Deny post to `/api/auth/oauth2/consent`. Every dynamic value goes
     through `escapeHtml`.
5. **`POST /mcp`** (`gateway/src/relay/mcp.ts`), Streamable HTTP answering JSON:
   - body cap 1 MiB; bearer token validated (active, not revoked, client not disabled, audience = the resource);
     per-account and per-client rate limits;
   - one JSON-RPC message (a batch is refused); notifications and responses get 202 and are not forwarded;
   - `tools/call` for a tool outside the token's scopes is refused here, before forwarding; `tools/list` results are
     filtered to the token's scopes (the desktop filters too; the scope table is §5's);
   - forwarded to the account's most recently active desktop socket; none live → JSON-RPC error **"Prose is not
     running"**; no answer within 60 s → a timeout error. Nothing queues;
   - `GET`/`DELETE /mcp` → 405 (stateless; no server-initiated stream).
6. **`GET /relay`** (`gateway/src/relay/socket.ts`, `hub.ts`): WebSocket, authenticated with the desktop's existing
   gateway session cookie.
   - Refused with an `Origin` header (a browser page, where the writer may now hold a gateway session from the
     consent flow, must never be able to pose as the desktop) and without a valid `device` query id.
   - One socket per account + device (a newer one replaces the older, close code 4000); calls go to the most
     recently active socket (connect, or an `{type:'active'}` frame).
   - Heartbeat `{type:'ping'}` every 25 s; a socket silent for 60 s is closed. Frame cap 10 MiB for results
     (`maxPayload`); an oversized result fails that call and the socket.
   - Frames (§4): gateway → desktop `{type:'call', id, client:{id,name,verified}, scopes, method, params, headers}`;
     desktop → gateway `{type:'result', id, result}` or `{type:'result', id, error:{code,message}}`. `headers`
     carries the client's SEP-2243 standard MCP headers (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`,
     `Mcp-Param-*`), which the desktop's v2 SDK handler checks on 2026-07-28 requests; it is the one addition to §4.
     A result is accepted only from the socket the call went to.
7. **Revoke by client**: `POST /api/relay/revoke {clientId}` (session, the desktop calls it when the writer removes a
   remote connection): marks the account's access and refresh tokens for that client revoked and deletes the consent,
   in one transaction. The next `/mcp` call with any of them gets 401.
8. **Logs**: one metadata line per relayed call (`[relay] account=… client=… method=… tool=… ms=… in=…B out=…B
   outcome=…`), and socket open/close lines. Never params, results, or document text. CIMD and DCR registrations log
   the client id only.
9. **Session expiry vs. 30-day refresh**: the plugin binds tokens to the consent's browser session and treats a
   token whose session row has **expired** as inactive; refreshed tokens keep that binding. Deleting an expired
   session clears the binding (`ON DELETE SET NULL`), and `offline_access` refresh tokens outlive it by design. So
   the gateway deletes expired sessions before each refresh-token exchange and on an hourly sweep; without it,
   remote access would end when the consent session expires (7 days), not after 30.
10. **Config** (all optional, defaults shown; none needs setting on Render): `RELAY_OAUTH_IP_MAX` (60 OAuth requests per
    IP per minute), `RELAY_REGISTER_IP_MAX` (10 DCR registrations per IP per hour), `RELAY_ACCOUNT_RATE_MAX` (120 calls
    per account per minute), `RELAY_CLIENT_RATE_MAX` (60 per account + client per minute), `RELAY_CALL_TIMEOUT_S`
    (60). Test-only, refused outside development: `CIMD_TEST_ORIGIN` (sends CIMD fetches to a local stub server).
11. **`docs/privacy.md`**: what the relay carries, that it stores no document content, what it logs, and how to turn
    it off.

## Verification

`gateway/scripts/test-relay.mjs`, `npm run test:relay`, added to `gateway.yml`: spawns its own gateway against
Postgres, a stub CIMD metadata server, and fake desktop sockets.

- discovery: PRM, AS metadata (S256 only, CIMD flag, registration endpoint), the 401 challenge;
- DCR (and its per-IP limit), and CIMD through the stub (the client is `verified`);
- the full code flow with PKCE: sign-in through the page's API calls, consent, code → token; a wrong verifier, no
  `code_challenge`, and `plain` are refused; refresh rotates;
- audience: authorize without `resource`, or with another one, is refused; a token minted for another audience fails
  at `/mcp`;
- a call forwarded to a fake desktop socket and answered; the frame's client, scopes and headers; `tools/list`
  filtered and an out-of-scope `tools/call` refused at the gateway;
- cross-account isolation: writer A's token never reaches writer B's socket (B's socket sees nothing, A gets "Prose
  is not running");
- "Prose is not running" with no socket; replacement of a same-device socket; most-recently-active routing; an
  `Origin`-bearing upgrade refused; a socket without a session refused;
- revocation: after `/api/relay/revoke` the access token fails at once and the refresh token can't be exchanged;
- payload caps: a request over 1 MiB → 413; a result over 10 MiB fails the call;
- the expired-session sweep: a refresh after the consent session expired still yields a working token;
- logs: a document-text marker sent through tool arguments and results never appears in the gateway's output.

Falsification: the suite run against the merge-base (the release branch head) fails (the routes don't exist); each
check is also confirmed to fail when its guard is disabled, where that is cheap to do.
