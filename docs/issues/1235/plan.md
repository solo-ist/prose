# #1235 — M1: MCP protocol (1.9.1 epic #1230)

## Context

Prose's MCP server today is `@modelcontextprotocol/sdk` 1.32 (v1), which speaks protocol revisions up to
2025-11-25. The spec moved to **2026-07-28** (no sessions, no `initialize`, a per-request envelope,
`server/discover`). Claude's clients still speak 2025-11-25; others are rolling the new revision out. The
1.9.1 surface has to answer both. The server also lacks `instructions` (the guidance lives in a Claude-only
skill), reports a frozen `1.0.0`, returns only text, checks neither `Host` nor `Origin` (DNS rebinding), and
the dev instance shares port 9877 with the installed app.

## SDK finding (2026-11-07)

- `@modelcontextprotocol/sdk` latest is 1.32.2: `LATEST_PROTOCOL_VERSION = 2025-11-25`, no 2026-07-28.
- **v2 is the stable line and implements 2026-07-28**: `@modelcontextprotocol/server` / `client` / `core`
  2.4.0 (2026-10-23). One server factory serves both eras: `createMcpHandler(factory, { legacy: 'stateless' })`
  on HTTP (modern requests per-request; 2025 requests through the stateless fallback, the shape Prose already
  serves) and `serveStdio(factory)` on stdio (the opening exchange pins the era per connection).
  `@modelcontextprotocol/node` 2.1.2 adapts the fetch-style handler to `node:http` (`toNodeHandler`).
- v2 depends on zod 4. The app's own tool schemas are zod 3 (`zod-to-json-schema`), and zod was only ever a
  hoisted transitive dependency, so installing v2 would have hoisted zod 4 under the app. **`zod` is pinned as
  a direct `^3.25.76` dependency** (the version already resolved); v2 gets its own nested zod 4. The zod 4
  migration stays #1216.

## Changes

1. **Dependencies.** `@modelcontextprotocol/sdk` → `@modelcontextprotocol/server` + `@modelcontextprotocol/node`
   (dev: `@modelcontextprotocol/client` for the protocol tests); `zod` pinned as above; the electron-vite main
   external becomes `/^@modelcontextprotocol\//`.
2. **One server definition** in `src/shared/mcp/server.ts`, used by the HTTP server and the stdio bridge:
   `createProseMcpServer({ version, invoke })` → a v2 low-level `Server` with `instructions`,
   `serverInfo { name: 'Prose', version }`, `tools/list` from the registry and `tools/call` through `invoke`;
   `toCallToolResult(ToolResult)` (text + `structuredContent` for object payloads, `isError` on failure).
   `src/shared/mcp/instructions.ts`: the client-neutral guidance (read before editing, node ids, suggestions
   are decided by the writer, comments, tabs).
3. **Tool metadata** (`src/shared/tools/`): `getToolsForMCP()` adds `outputSchema` (permissive object
   schemas per tool, `src/shared/tools/mcpOutputSchemas.ts`), `annotations` (`readOnlyHint` /
   `destructiveHint` / `openWorldHint`), and an MCP-specific description for the three tools whose text
   names tools MCP clients cannot call (`read_document` and `suggest_edit` name `edit`;
   `create_and_open_file` says "from Claude Desktop"). A test fails if any MCP description names a tool
   outside the MCP set.
4. **HTTP server** (`src/main/mcp/http-server.ts`): `createMcpHandler` behind, in order, Host validation
   (`localhost`, `127.0.0.1`, `[::1]`, `host.docker.internal`), Origin validation (absent, or the same hosts),
   the existing constant-time bearer check; CORS allow-list gains `MCP-Protocol-Version` and `Last-Event-ID`;
   the port is passed in by `index.ts`; the stale "HTTP/SSE … deprecated" header is replaced.
5. **Port per instance** (`src/main/index.ts`): `PROSE_MCP_PORT`, else 9877 packaged and **9878 unpackaged**
   (dev and e2e), so a dev window never takes the installed app's port.
6. **Socket server**: tool results go through `toCallToolResult` (the same shape, plus `structuredContent`), so
   an older installed stdio bridge keeps working.
7. **stdio bridge** (`src/mcp-stdio/index.ts`): `serveStdio(factory)` from the shared definition; the profile is
   `PROSE_USER_DATA_DIR`, else the profile the bridge was installed into (`<profile>/mcp-server/`), else the
   installed `Prose` profile (finishes #1139); auto-launch only for the installed profile; the version is
   injected at build time (`__PROSE_VERSION__`).

## Out of scope

Connections and long-lived tokens (M2, #1236), document targeting (M3, #1237), new tools (M4, #890). The
`COMMENT_EXISTS` error text names `reply_to_comment`, which MCP gains in M4.

## Verification

- vitest, node environment: `src/main/mcp/http-server.test.ts` starts the server on an ephemeral port with a
  fake `invoke` and checks, through the v2 client, **both eras** (2025-11-25 `initialize` and 2026-07-28
  pinned): `tools/list` (descriptions, `outputSchema`, annotations), a `tools/call` with `structuredContent`
  the client validates against the schema, an error result, `instructions` and the server version; a raw
  2025 POST without `initialize` (today's e2e shape); Host and Origin rejections (403), `host.docker.internal`
  accepted, a missing or wrong bearer (401), the CORS preflight headers.
- vitest: `toCallToolResult`; output schemas against fixtures built from each executor's success payload;
  the description tripwire; the stdio profile resolution.
- Falsified: the new tests run against the merge-base's `src/` (they fail: no v2 server, no Host check, no
  structured results).
- `typecheck:renderer` at its baseline; `npm run test:unit`; `npm run build`; e2e `path-containment` (MCP
  allowlist over HTTP, default port updated to 9878), `mcp-status`, `mcp-socket-path`.
