# #1239 — M5b: the remote MCP relay, desktop side (1.9.1 epic #1230)

Stacked on M5a (#1238, PR #1280): the gateway's OAuth server, `POST /mcp` and the `/relay` socket. Design of record:
[`docs/architecture/mcp-relay.md`](../../architecture/mcp-relay.md) §6, with the operator's §8 decisions.

## Context

After M5a, ChatGPT and claude.ai can authorize against the gateway, but every call ends at "Prose is not running":
no desktop dials out. M5b is the desktop half. The signed-in direct build opens the relay socket when the writer turns
on **Remote access**, answers the calls it carries through the same MCP server definition the local endpoint uses,
and enforces the second gate: a remote client reaches nothing until the writer approves it in Prose, with the scopes
the writer picks.

## Design

1. **Remote access** (Settings → Integrations → Connections, a new "Remote access" block, `RemoteAccess.tsx`):
   a switch, off by default, shown on the direct build only (the MAS build has no Integrations tab, and every IPC
   handler refuses there). It needs the gateway sign-in (Settings → Account); signed out, the switch is disabled and
   says so. On, main opens the socket; off, main closes it at once (the kill switch). The state lives in main's own
   store, not in renderer-writable `settings.json`. The block shows the status (Off, Connecting, Connected,
   Reconnecting with the last error, Signed out, Replaced by another window) and the connector URL to paste into
   ChatGPT or claude.ai (`<gateway>/mcp`, so `https://api.prose.solo.ist/mcp`), with short setup notes for both.
2. **Store** (`src/main/mcp/remoteConnections.ts`, `<userData>/mcp-remote.json`, 0600, written atomically like the
   connection store): `{ enabled, deviceId, connections }`. The device id is 18 random bytes, base64url, made once.
   A remote connection: `{ id, clientId, clientName, verified, label, status: pending | approved | denied, scopes,
   firstSeenAt, approvedAt, lastUsedAt }`; names and labels go through `cleanActorText`. `id` is
   `remote:<client id>`, or `remote:sha256:<40 hex>` when that would pass the actor's 100-character cap (a CIMD
   client id is a URL). At most 20 pending rows; the oldest pending row makes way.
3. **The socket** (`src/main/mcp/relay.ts`, `RelayClient`): Node's built-in WebSocket (Electron 45, Node 24: it
   sends custom headers and no `Origin`), `ws(s)://<gateway>/relay?device=<id>` with the stored, origin-bound
   gateway session cookie. Answers `ping` with `pong`; sends `{type:'active'}` when a Prose window gains focus;
   reconnects with backoff (1 s doubling to 60 s, reset after a hello); treats 75 s without a frame as a dead socket.
   Stops without retrying on close 4000 (another window of this profile took over) and on 4003 or a 401 at upgrade
   (signed out). Signing in or out (share/index.ts) restarts or stops it. `isMas` is a constructor input: true means
   it never dials. Results over 10 MiB are answered with an error instead.
4. **A call** (`src/main/mcp/relayCalls.ts`): the frame is checked (shape, sizes), then the client looked up by its
   gateway client id.
   - Unknown: recorded as **pending** (name, verified) and refused: "Approve <client> in Prose → Settings →
     Integrations → Connections, then try again." The renderer is told to refresh the list.
   - Pending or denied: refused.
   - Approved: the effective scopes are the writer's choice ∩ the token's scopes (the gateway's consent); none left
     → refused. The JSON-RPC request is rebuilt (`method`, `params`, the frame id) with the forwarded standard
     headers and served by `createMcpHandler` over `createProseMcpServer`, now with an `allowedTools` set from the
     shared scope table: `tools/list` lists only those tools, and a `tools/call` for any other is an error before
     anything runs. The JSON (or 2025-era SSE) response is unwrapped into `{result}` or `{error}`.
   - The actor (§6): `{ kind: 'mcp-agent', connectionId: 'remote:…', connectionLabel: <the writer's label>, client:
     <the registered name>, via: 'relay' }`, built in main, sent beside the call as for every MCP call.
5. **Scope table** (`src/shared/mcp/remoteScopes.ts`): the gateway's `gateway/src/relay/scopes.ts`, copied; a unit
   test fails if the two differ, if a remote tool isn't an MCP tool, or if a filesystem or view-moving tool (or
   accept / reject) appears. The renderer's MCP handler also refuses, for a `via: 'relay'` actor, any tool outside
   the remote set (defence in depth behind main).
6. **Approve, deny, revoke** (IPC `mcp:remote:*`, all refused on MAS): approve with scopes (read is always included;
   propose and comment are choices) and an optional label; change scopes or label later; deny (the row stays as
   declined, its calls refused); remove. Remove and deny refuse the client's calls at once in the app, then ask the
   gateway to revoke its tokens for the account (`POST /api/relay/revoke`); a failed revoke is reported, and the
   local refusal stands either way.
7. **Manners**: remote tools never include `select_tab`, `open_file` or `create_and_open_file`, and MCP calls already
   keep the writer's caret, focus and tab (M3).

## Verification

- vitest (node): the store (file mode, pending cap, approve / deny / scopes / rename / remove, the id rule); the call
  handler (unknown → pending + refused; approved `read` allows `read_document` and refuses `add_comment`;
  `tools/list` filtered; scopes intersected with the token's; the actor; denied; malformed frames); the relay client
  against a local WebSocket server (cookie and device on the upgrade, pong, reconnect, the kill switch, no dial-out
  when `isMas`, 4000 stops, an oversized result answered with an error); the scope table against the gateway's.
- e2e `electron.mcp-relay.spec.ts` against a **real local gateway** (spawned from `gateway/`, Postgres; skipped
  without `PROSE_E2E_GATEWAY_DATABASE_URL`, which CI's e2e job now provides with a Postgres service): the app signs in
  to the gateway, Remote access on, a remote client (DCR, consent and PKCE through the gateway's API) calls
  `read_document` and is refused as unapproved; the client appears pending in Settings; approved with `read`,
  `read_document` works and `add_comment` is refused by the desktop although the token carries `comment`; with
  `comment` added, the comment's stored actor carries `via: 'relay'` and the connection's label; the kill switch makes
  the next call "Prose is not running"; removing the connection revokes the client at the gateway (401).
- Baselines unchanged (`typecheck:renderer` 66, `tsconfig.node.json` 18, `typecheck:e2e` 6), `npm run test:unit` green.
- Falsified on the merge-base (M5a's head): the new unit tests and the spec fail there.

## As built

- **Frames.** The desktop answers the gateway's `hello`, `ping` and `call` frames (M5a's plan lists the `headers` and
  `hello` additions to the design's §4). A malformed call with an id gets a `-32600` answer; one without an id is
  dropped. Desktop refusals are JSON-RPC errors after the gateway's range: -32010 not approved, -32011 declined,
  -32012 no permissions; a tool outside the connection's scopes is an `isError` tool result from the shared server.
- **Who gets the call.** The gateway routes to the most recently active desktop; the desktop marks itself active on
  window focus. A newer socket from the same profile replaces the older, which then stays off ("Replaced") rather than
  fight for it.
- **A pending client** also raises a toast with a Review action that opens Settings → Integrations.
- **The MAS gates spec** (`e2e/electron.mas-gates.spec.ts`) gains a Remote access check. Running it on a MAS build
  locally showed an unrelated, pre-existing failure in its "Share, Shared, Account and Integrations are absent" test:
  General's email hint ("… sent to agents or share viewers", from #1232) matches its direct-only pattern. CI never
  runs that spec (it needs a MAS build), so it went unnoticed; not changed here.
