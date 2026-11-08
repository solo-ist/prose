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

## Execution log

- **2026-11-07.** Plan `19191fa`; change `03e04c0`.
  - Built on `@modelcontextprotocol/server` 2.4.0 + `@modelcontextprotocol/node` 2.1.2 (client 2.4.0 as a dev
    dependency); v1 removed. Installing v2 first hoisted zod 4.6.7 to the root, under the app's zod-3 schemas and
    the AI SDK: caught in `npm ls zod`, fixed by the direct `zod ^3.25.76` pin (root back to 3.25.76; zod 4 nested
    under the MCP packages only).
  - `app.getVersion()` reports Electron's version when unpackaged (the e2e caught `45.2.3`): an electron-vite
    `define` did not reach the SSR main build, so `src/main/mcp/version.ts` reads `package.json` when unpackaged.
  - `path-containment`'s MCP allowlist test now pins `PROSE_MCP_PORT` for its launch (with the unpackaged default
    moving to 9878 it would otherwise have skipped itself silently).
  - Tests: vitest 206/206 (new: `http-server.test.ts` 20 — both eras through the v2 client, wire-level proof of each
    era, Host/Origin/bearer guards, CORS, ports; `shared/mcp/server.test.ts` 16 — every output schema against its
    executor's payload, a schema that rejects, the description/instructions tripwire, `toCallToolResult`;
    `profile.test.ts` 4). e2e: `electron.mcp-protocol.spec.ts` 5 (HTTP and stdio at both eras against the built app,
    structured results validated by the client, the bridge with no app on its profile), plus `mcp-status`,
    `mcp-socket-path`, `path-containment`, `onboarding`, `tab-caret`: 24 passed.
  - **Falsified** on a build of the merge-base (`84ba7bd`, its own worktree and `node_modules`): all five new e2e cases
    fail there — version `1.0.0`, no instructions, `server/discover` not offered for 2026-07-28 (HTTP and stdio), and
    the base bridge ignored `PROSE_USER_DATA_DIR` (its `list_tabs` reached the installed app's socket instead of
    failing; read-only). The unit tests target modules the base lacks.
  - `typecheck:renderer` 69 = base; `typecheck:e2e` 6 = base; `tsconfig.node.json` 24 = base. `npm audit --omit=dev`
    unchanged (47; `@hono/node-server` now arrives via `@modelcontextprotocol/node`, the root override still pins it
    below 2).
  - Note for M2: the bridge targets Node 20 (v2's floor), and Claude Desktop runs it with the system `node`; the
    `.mcpb` in M2 removes that dependency.
- **2026-11-07, after M4 (#890, `4f4d899`).** Merged `origin/main`. M4's seven tools (`reply_to_comment`,
  `reopen_comment`, `list_suggestions`, `reply_to_suggestion`, `revise_suggestion`, `get_review_status`,
  `list_review_events`) get titles, annotations (the three readers read-only; the others not destructive) and output
  schemas from their executors' payloads, so they answer with `structuredContent` too; their shared descriptions were
  already client-neutral. The server instructions now describe the review lifecycle (propose, revise, discuss; the
  writer decides; outcomes through `list_review_events`). The tests that every MCP tool has metadata and an output
  schema accepting its payload, and that the document tools keep `document`, cover the new tools through
  `mcpToolNames`; `mcp-protocol` compares the bridge's tool list with the app's instead of a fixed 10. Unit 257/257;
  `typecheck:renderer` 66, `typecheck:e2e` 6; M4's `mcp-review` (on port 9246) with the MCP, targeting, provenance
  and review-log specs: all passed.
