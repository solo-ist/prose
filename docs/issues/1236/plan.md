# #1236 — M2: MCP connections (1.9.1 epic #1230)

Stacked on M1 (#1235, PR #1249): the PR's base is `issue-1235-mcp-protocol` until M1 merges.

## Context

Since M1, any client that connects by URL (Claude Code, Codex, Open WebUI, LibreChat) speaks to the HTTP endpoint,
but the only credential is the per-launch token in `<userData>/mcp-auth-token`: it rotates on every launch, so a
saved client config breaks on restart, and every MCP record is stamped with P1's placeholder actor
(`{ connectionId: 'launch', connectionLabel: 'MCP client' }`, set in the renderer). M2 makes the **connection** the
MCP identity: a named, revocable token per client, created in Settings, resolved by main, and the actor built by
main from it — never from anything the client sends as tool arguments.

## Design

1. **Connection store** — `src/main/mcp/connections.ts`, `<userData>/mcp-connections.json` (mode 0600, written
   to a temp file and renamed). Record: `{ id, label, tokenHash, createdAt, lastUsedAt }`; `tokenHash` is the
   SHA-256 hex of the token, never the token. Tokens are `prose_mcp_` + 32 random bytes (base64url), shown once at
   creation. Labels go through `cleanActorText` and must be non-empty and unique (case-insensitive), so two
   connections can always be told apart in a record. `resolve(token)` hashes and compares in constant time;
   `lastUsedAt` is kept in memory and written at most once a minute. A revoked connection is deleted, so its token
   fails on the next request.
2. **IPC** (`ipc.ts`, refused on MAS): `mcp:connections:list`, `:create` (label → `{ connection, token }`, the only
   time the token leaves main), `:rename`, `:revoke`, and `mcp:endpoint` (`{ available, port, url }` for the setup
   snippets). Preload + renderer types + the browser/web fallbacks.
3. **HTTP auth** (`http-server.ts`): `Authorization: Bearer` is checked against the per-launch token (kept, so
   existing setups and the e2e keep working; actor `launch`) and then the connection store. The resolved actor rides
   to the server factory as the SDK's pass-through `authInfo` (`req.auth`), and every `tools/call` on that request
   carries it. HTTP actor: `{ kind: 'mcp-agent', connectionId, connectionLabel, via: 'http' }`, plus the client's
   self-reported name and version when a 2026-07-28 request's envelope carries them (cleaned, shown beside the label).
4. **stdio actor**: the shared server definition hands `callTool` the client's `clientInfo` (2025 era: the
   connection's `initialize`; 2026-07-28: the request envelope). The bridge forwards it on the socket's `tools/call`
   (`params.client`); main builds `{ connectionId: 'launch', connectionLabel: <client name or 'MCP client'>, client,
   clientVersion, via: 'stdio' }`, every string through `cleanActorText`.
5. **Bridge** (`bridge.ts`): `executeTool(name, args, actor)` sends the actor as the fourth `mcp:tool:invoke`
   argument; the tool timeout goes from 30 s to 120 s (above stdio's 60 s `suggest_edit` and the 60 s defaults of
   Codex and LibreChat, so the app is never the first to give up). The preload passes the actor through; the
   renderer's MCP handler (`App.tsx`) validates it (`mcpActorFrom`: kind `mcp-agent`, strings cleaned, `via` one of
   the three) and uses it as the provenance actor; with none (a hand-sent IPC in a spec) it falls back to P1's
   `launch` placeholder. Tool arguments are never read for identity.
6. **Settings → Integrations → Connections** (`components/settings/McpConnections.tsx`, shadcn only, no
   `innerHTML`): add a connection by name → the token, shown once with a copy button; the list with last use,
   rename and revoke (confirm dialog); per-client setup, filled with the endpoint URL and, right after creation, the
   token: Claude Code (`claude mcp add --transport http …`), Codex (`config.toml` with `bearer_token_env_var`), Open
   WebUI (URL + bearer, `host.docker.internal` from Docker), LibreChat (`librechat.yaml` with `allowedAddresses`).
7. **Claude Desktop `.mcpb`**: decided at the end of the build (packaging is a zip of `manifest.json` (0.3) and the
   bundled server; no new dependency needed with `zlib.crc32`), or filed as a follow-up with the findings if it
   doesn't fit.

## Verification

- vitest: the store (hash-only storage, file mode, create/resolve/rename/revoke, duplicate and empty labels,
  `lastUsedAt` throttling, a corrupt file); the HTTP endpoint (a connection token works, a revoked one gets 401
  at once, the launch token still works, the actor reaching `invoke` for each); the stdio `clientInfo` hand-off for
  both eras; `mcpActorFrom`.
- e2e `electron.mcp-connections.spec.ts` (port 9242): create a connection through the preload API, call `/mcp`
  over HTTP with its token (`add_comment`), check the comment's stored actor and `list_comments`'s `by` carry the
  connection label, revoke it, and get 401 with the same token; the Settings UI shows the token once and lists the
  connection.
- Falsified on the merge-base (M1's head): the new specs fail there.
- `typecheck:renderer` 66, `typecheck:e2e` 6, unit, build; MCP e2e (M1's, targeting, provenance) stay green.

## Execution log

- **2026-11-07.** Plan `06ba9de`; change `a25c240`, on M1's head `83d2b7c` (main's P2 #1252 is not in this stack;
  nothing here overlaps it).
  - Steps 1–4 built as designed. The `.mcpb` (step 5) is filed as **#1257** with the findings: manifest 0.3 format
    from the extensions installed on this machine, a dependency-free zip writer on `zlib.crc32`, the per-profile
    `env` a dev build needs, the GUI-only install step, and two open questions (Claude Desktop's built-in Node
    against the bridge's Node 20 target; extensions vs plugins as the long-term route).
  - The SDK's pass-through `authInfo` carries the caller from the bearer check to the per-request server factory
    (`toNodeHandler` forwards `req.auth`), so no request state is shared between calls.
  - Tests: vitest 255/255 (new: `connections.test.ts` 6, `actor.test.ts` 3, `clientInfo.test.ts` 2 — both eras over
    a stdio-style connection, `mcpSetupSnippets.test.ts` 3; `http-server.test.ts` +4 — the launch token's actor, a
    connection token's actor at both eras with a spoofed `actor` argument ignored, revocation → 401). e2e
    `electron.mcp-connections.spec.ts` 2 (create via the preload API → HTTP `add_comment` with the token →
    `list_comments` `by` and the stored row's actor carry the connection → revoke → 401; the Settings UI shows the
    token once, fills the snippets, lists, revokes). With M1's MCP specs, targeting, provenance and settings-account:
    28 passed.
  - **Falsified** against M1's head (`git checkout 83d2b7c -- src`, rebuilt): the e2e fails
    (`mcpCreateConnection is not a function`; the UI case finds no panel), the new `http-server.test.ts` fails at
    setup (`setConnectionResolver` missing), and `clientInfo.test.ts` fails 2/2 (no context reaches `callTool`).
  - `typecheck:renderer` 66, `typecheck:e2e` 6; no main-project errors in the touched files.
