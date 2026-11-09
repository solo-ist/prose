# The MCP relay: ChatGPT and claude.ai to a writer's Prose

**Status.** Design of record for M5a ([#1238](https://github.com/solo-ist/prose/issues/1238), gateway) and M5b ([#1239](https://github.com/solo-ist/prose/issues/1239), desktop), part of the 1.9.1 epic ([#1230](https://github.com/solo-ist/prose/issues/1230)). Written 2026-11-07, before any code. The relay is the largest security surface in 1.9.1: it opens a path from the internet into the writer's desktop app. So this document is reviewed first, and both PRs are security-gated.

**Reading it cold.**
- §1: why the relay exists.
- §2: the shape.
- §3: authorization.
- §4: the relay protocol.
- §5: what a remote client may do.
- §6: the desktop side.
- §7: threats.
- §8: the operator's decisions.
- §9: delivery and tests.

## 1. Why

The local MCP surface (M1–M4) covers Claude Desktop, Claude Code, Codex (including the ChatGPT desktop app's Codex mode), Open WebUI and LibreChat. Two client groups can't reach a server on the writer's Mac:
- **ChatGPT**: web, mobile, and the desktop app's Chat mode;
- **claude.ai**: web, mobile, Cowork, and Claude Desktop's *connectors*.

Their calls come from the vendors' clouds. They need a public HTTPS endpoint with OAuth 2.1, and ChatGPT accepts no static keys. Asking writers to run a tunnel would put their desktop on the internet behind a token they manage, so the gateway Prose already runs (`prose.solo.ist`) relays instead.

## 2. Shape

```
ChatGPT / claude.ai ──HTTPS + OAuth 2.1──▶ prose.solo.ist/mcp ──WebSocket (outbound from the app)──▶ Prose desktop
                                            (gateway: authorizes, forwards       (approves the client, enforces
                                             in memory, stores no content)         scopes, runs the tool, answers)
```

- **The desktop dials out.** The relay socket is an outbound WebSocket from the signed-in desktop app to the gateway. The writer's machine opens no port.
- **The gateway forwards calls in memory only.** It answers a remote client only while that writer's app is connected. With the app closed, the client gets "Prose is not running": nothing queues and nothing is stored.
- **Off by default.** The desktop opens the relay only after the writer turns on **Remote access** in Settings → Integrations → Connections. The direct build only, never the App Store build.

## 3. Authorization (M5a)

The gateway becomes an OAuth 2.1 authorization server for one protected resource, `https://prose.solo.ist/mcp`. It uses `@better-auth/oauth-provider` and `@better-auth/cimd`, the plugins matching the gateway's Better Auth 1.7.x; the gateway hand-rolls no token crypto.

| Requirement (MCP authorization, 2025-11-25 / 2026-07-28) | How |
|---|---|
| Protected Resource Metadata (RFC 9728) | `/.well-known/oauth-protected-resource/mcp`, naming one authorization server (Claude reads only the first) |
| 401 starts discovery | `WWW-Authenticate: Bearer resource_metadata="…"` on every unauthenticated `/mcp` request |
| Authorization server metadata | `/.well-known/oauth-authorization-server`, with `client_id_metadata_document_supported: true` |
| Client registration | **CIMD** (Client ID Metadata Documents, `@better-auth/cimd`; ChatGPT prefers it), plus **DCR** (`allowDynamicClientRegistration`) for clients that only register. DCR is rate-limited per IP |
| PKCE | S256 required |
| Audience binding (RFC 8707) | The `resource` parameter is required, and tokens are bound to `https://prose.solo.ist/mcp`. A token for any other audience is refused |
| Token lifetimes | Access tokens 1 hour; refresh tokens 30 days, rotated on use |
| Consent | The writer signs in with the existing email sign-in and approves the client by name, on the gateway. This is the first of two gates (§6) |
| Response time | OAuth endpoints answer well inside Claude's 10-second limit, since they do no outbound calls other than a CIMD fetch, which has a short timeout |

**Accounts.** An OAuth grant belongs to a Prose account (the Better Auth user). The desktop's relay socket authenticates as the same account with the desktop's existing gateway session, so **a call is routed only to sockets of the account its token belongs to**. Cross-account routing is impossible by construction, and the gateway suite tests it.

## 4. The relay protocol

**Endpoint.** `POST /mcp` is Streamable HTTP and answers JSON. It speaks the two protocol revisions M1 serves:
- 2026-07-28 (stateless, `server/discover`);
- 2025-11-25.

Every request is authorized as in §3, then forwarded.

**The socket.** `GET /relay` upgrades to a WebSocket, authenticated with the desktop's gateway session.
- **Socket limits.** One live socket per account and device; a newer one from the same device replaces the older. Payload caps: requests 1 MiB, results 10 MiB.
- **Heartbeats.** Every 25 seconds. A socket silent for 60 seconds is closed.

**Messages,** as JSON frames.
- Gateway → desktop:

  ```json
  { "type": "call", "id": "<uuid>",
    "client": { "id": "<oauth client id>", "name": "<registered name>", "verified": true },
    "scopes": ["read", "propose"], "method": "tools/call", "params": { ... } }
  ```

  `verified` is true when the client was identified through CIMD (domain ownership), and false for DCR.
- Desktop → gateway: `{ "type": "result", "id": "<uuid>", "result": { ... } }` or `{ "type": "result", "id": "<uuid>", "error": { "code": …, "message": … } }`.

**Routing.**
- The gateway awaits the matching `id` for up to 60 seconds, then answers the remote client. Tool calls are request/response; nothing in M4 streams.
- Several desktops on one account: the call goes to the most recently active one.
- `tools/list` is answered by the desktop, so it always matches the app's version and the client's scopes.

**Logs.** The gateway logs metadata only: account, client, method, tool name, duration, bytes and outcome. It never logs params or results.

**Scaling.** Routing is in memory, which holds while the gateway runs as one Render instance (as today). A second instance would need a pub/sub hop (Postgres `LISTEN/NOTIFY` is enough); that is noted, not built.

## 5. What a remote client may do

Remote clients get **less than local ones**: they work on documents the writer has open, and never touch the filesystem.

| Scope | Tools |
|---|---|
| `read` | `list_tabs`, `read_document`, `get_outline`, `list_comments`, `list_suggestions`, `get_review_status`, `list_review_events` |
| `propose` | `read`, plus `suggest_edit`, `revise_suggestion`, `reply_to_suggestion` |
| `comment` | `read`, plus `add_comment`, `reply_to_comment`, `resolve_comment`, `reopen_comment` |

Scopes are cumulative grants of tools, not separate permissions: `propose` and `comment` each *include* every `read` tool, so a client approved for `comment` alone can still read. The writer can grant both `propose` and `comment`.

**Never remote:**
- `open_file`, `create_and_open_file` and `select_tab`, which would let a cloud client open local files or move the writer's view;
- accept and reject, which the writer always decides (#607).

The `document` target (M3) still names only open tabs. The desktop enforces scopes; the gateway also filters `tools/list` and refuses an out-of-scope `tools/call` before forwarding it.

## 6. The desktop side (M5b)

**Remote access.** A switch in Settings → Integrations → Connections, off by default and shown only to a signed-in direct build. Turning it on opens the socket, which reconnects with backoff. Turning it off closes it at once: the kill switch.

**Second gate: approval in the app.** The first call from a client the writer hasn't approved is refused ("Approve <client> in Prose → Settings → Connections"). The client then appears there as pending, with its name and whether it is verified. The writer approves it with scopes (read / propose / comment) or denies it. An approved client is a connection like the local ones, with a label the writer can change. Even a stolen OAuth token, or a compromised gateway account, reaches nothing the writer hasn't approved in the app itself.

**Revoke.** Removing a remote connection refuses its calls in the app at once, and asks the gateway to revoke that client's tokens for the account.

**Actor.** Records the client makes carry:

```ts
{ kind: 'mcp-agent', connectionId: 'remote:<client id>', connectionLabel: <the writer's label>, client: <registered name>, via: 'relay' }
```

So Activity, the review log and `list_review_events` show who it was (P1, P2, P4).

**Manners.** As for every MCP call (M3), a remote call never moves the writer's caret, focus or tab.

## 7. Threats

| Threat | Mitigation | Residual |
|---|---|---|
| A stolen access token | Audience-bound, 1-hour lifetime, revocable; the in-app approval and scopes still apply | Within its hour, a stolen token can do what its client was approved for |
| A malicious or compromised MCP client | No filesystem tools; open documents only; scopes; every record attributed; nothing is decided without the writer | It can read the open documents it was approved to read; that is the feature |
| Prompt injection through document text | The same as local agents. Agents propose and the writer decides; nothing an agent writes applies itself | As for every agent |
| A compromised gateway | It can only forward calls *as* clients the writer approved, within their scopes, while Remote access is on; every call is attributed; the switch is a kill switch | A gateway breach exposes open documents during the breach. The gateway stores none, so a breach exposes no history |
| Cross-account routing | Calls route only to the token's own account; tested | — |
| Denial of service | Per-account and per-client rate limits; payload caps; DCR rate-limited per IP | — |
| CIMD fetch abuse (SSRF) | `@better-auth/cimd` fetches only `https` URLs, with a short timeout and a size cap; private address ranges are refused | — |

## 7a. Settled at implementation (review of #1255; M5a #1280)

- **The connector URL** is `https://api.prose.solo.ist/mcp`, the gateway's existing host (the OAuth resource must be the URL clients connect to). Serving it on `prose.solo.ist` would need a DNS or proxy change, which is the operator's; nothing here depends on it.
- **"Device"** is a random id the desktop generates once per profile and keeps in its user-data folder, sent as the `device` query parameter when it opens `/relay`. It is not derived from the network: no IP or User-Agent. There is one socket per account and device; a newer socket from the same device replaces the older (close code 4000). Calls go to the **most recently active** device: the one that connected last, or that sent an `{type:'active'}` frame (the desktop sends one when its window gains focus). Settings → Connections shows whether this Mac is the one receiving remote calls ("Receiving remote calls" / "Another Mac is active"), so a writer with two signed-in Macs isn't surprised.
- **Rate limits**, all overridable by environment variable, none required on Render:
  - OAuth routes: 300 requests per IP per minute (`RELAY_OAUTH_IP_MAX`).
  - DCR: 30 registrations per IP per hour (`RELAY_REGISTER_IP_MAX`); the vendors' servers share IPs, hence the generous figures.
  - Relayed calls: 120 per account per minute (`RELAY_ACCOUNT_RATE_MAX`) and 60 per account and client per minute (`RELAY_CLIENT_RATE_MAX`).
  - The call timeout is 60 s (`RELAY_CALL_TIMEOUT_S`).
- **A call in flight when the desktop's socket drops** (a lid closed mid-`suggest_edit`) fails at once with JSON-RPC error -32004 ("disconnected"). The gateway doesn't wait for the timeout and doesn't queue or retry. The other relay errors are -32001 (Prose is not running), -32002 (timeout), -32003 (result too large, 10 MiB cap) and -32602 (a tool outside the token's scopes). The gateway suite covers each one.
- **A pending client gets the writer's attention, not just the client's** (M5b). When a remote client is refused for lack of approval, the desktop shows an in-app notification naming the client, with **Review**, and keeps a count on Settings → Connections and on the Dock icon until the writer approves or denies it. The refusal message to the client stays as in §6.
- **`docs/privacy.md`** gains:
  - what the relay carries (calls and results, in memory, only while Remote access is on);
  - that no document content is stored;
  - the per-call metadata line it logs (account, client, method, tool name, duration, bytes in and out, outcome) and how long it is kept;
  - that turning Remote access off, or revoking a client, ends access at once.

## 8. The operator's decisions (decided 2026-11-09)

1. **Who gets Remote access:** any signed-in writer, free, in 1.9.1. The metadata logs show the cost; the Open Collective entitlement (#953) can gate it later if usage calls for it.
2. **Client registration:** CIMD and DCR both. DCR is rate-limited.
3. **Token lifetimes:** access tokens 1 hour, refresh tokens 30 days. Revoking a remote client in Prose ends it at once, whatever its refresh token says.
4. **Remote clients and files:** documents the writer already has open only. A remote client can't open, create or list files. A per-connection "may open files" scope is a possible later addition, not part of 1.9.1.

## 9. Delivery and tests

**M5a (gateway, #1238; security-gated, you deploy).**
- The OAuth provider and CIMD plugins, the Prisma migration for their tables, the two well-known documents, `POST /mcp`, `GET /relay`, revoke-by-client, rate limits, and `docs/privacy.md`.
- The gateway suite runs against Postgres and covers:
  - discovery;
  - DCR, and CIMD with a stub metadata server;
  - PKCE;
  - an audience mismatch refused;
  - a call forwarded to a fake desktop socket;
  - cross-account isolation;
  - "Prose is not running";
  - a revoked token;
  - payload caps.

**M5b (desktop, #1239; security-gated).**
- The relay client in main, the Remote access switch, pending, approve, deny and revoke, scope enforcement, and the actor.
- An e2e against a local gateway (the existing `gateway.yml` harness) covers:
  - an unapproved client refused;
  - approval with `read` permitting `read_document` and refusing `add_comment`;
  - records carrying `via: 'relay'`;
  - the kill switch.

**Your steps.**
1. Review this design.
2. Merge M5a and deploy the gateway: a migration and the env.
3. Merge M5b.
4. On your MacBook, add the connector in ChatGPT (developer mode, "Create custom MCP servers") and in claude.ai (Customize › Connectors › URL), then run the epic's loop.
