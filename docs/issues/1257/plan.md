# #1257 — M2b: a Claude Desktop extension (`.mcpb`) for the stdio bridge (1.9.1 epic #1230)

Operator decision (2026-11-09): build the `.mcpb` in 1.9.1; a plugin can replace it later.

## Context

Today Claude Desktop runs the stdio bridge with the system `node`: `mcp:install` writes `command: <which node>` into
`claude_desktop_config.json`. Since M1 the bridge targets Node 20 (the v2 MCP SDK's floor), so a Mac without Node, or
with an older one, can't use it. A Claude Desktop extension runs on Claude Desktop's own Node.

## Findings that shape it

- **Claude Desktop's built-in Node is v24.22.0** (Claude 4.23118.0, Electron 44.9.3; read from its Electron Framework
  binary, nothing launched). Its extension loader checks `compatibility.runtimes.node` against the system Nodes and
  falls back to the built-in one for a `node` command when none satisfies it (`app.asar`; it also reports
  `supportedLatestMcpbManifestVersion: "0.4"`). So `runtimes.node: ">=20.0.0"` works with or without a system Node.
- **Format:** a zip with `manifest.json` at the root and the server beside it. `manifest_version: "0.3"` (what
  Anthropic's own installed extensions use), `server: { type: "node", entry_point, mcp_config: { command: "node",
  args: ["${__dirname}/server/index.cjs"], env } }`.
- **No new dependency:** a store-only zip writer on `zlib.crc32` (Node 24.22.2 inside Electron 45, and the system
  Node for vitest).
- **Profile:** the bridge picks its profile from where it runs (#1235); an extension runs from Claude Desktop's
  extensions folder, so it falls back to the installed app's profile. A dev or test profile needs
  `PROSE_USER_DATA_DIR` in the manifest's `env`, so main generates the `.mcpb` per profile at install time.

## Changes

1. `src/main/mcp/zip.ts`: `createZip(entries)` — stored entries, UTF-8 names, Unix modes, a fixed 1980-01-01 timestamp
   (deterministic bytes); refuses what would need ZIP64.
2. `src/main/mcp/mcpb.ts` (pure): `mcpbManifest(version, profile, platform)` and `buildMcpb(server, manifest)`. The
   installed app's profile gets `name: "prose"` and no `env`; any other profile gets `prose-<profile slug>`, a display
   name that says which profile, and `env.PROSE_USER_DATA_DIR`. The manifest lists the MCP tools (name + first
   sentence of the description).
3. `src/main/mcp/bundledServer.ts`: `bundledMcpServerPath()` moves out of `ipc.ts` so both installs share it.
4. IPC `mcp:installExtension` (`src/main/mcp/extensionIpc.ts`, refused on MAS): writes
   `<userData>/mcp-server/Prose.mcpb` and `shell.openPath`s it, which opens Claude Desktop's install dialog.
   `PROSE_MCPB_OPEN=0` (test seam, like `PROSE_CLAUDE_CONFIG_PATH`) writes without opening.
5. Settings → Integrations: "Install the Claude Desktop extension" is the primary route; the config-file install stays
   below it as the fallback for a Mac with Node 20 or later. Preload, renderer types and the web fallbacks.
6. `CLAUDE.md` MCP section; QA block `## M2b (#1257)`.

## Verification

- vitest `zip.test.ts`: a round trip through the system `unzip` (`-l` names and sizes, `-t` CRCs, `-p` bytes), modes,
  the ZIP64 refusal. `mcpb.test.ts`: the manifest for the installed profile, a dev profile and a test profile
  (snapshots), and the built archive's two entries. Both fail on the base (no module).
- e2e `electron.mcpb.spec.ts`: `mcp:installExtension` with `PROSE_MCPB_OPEN=0` writes the file; unzipped, its manifest
  names this profile in `env`, its server is byte-identical to `out/mcp-stdio.cjs`, and the extracted server, run the
  way Claude Desktop runs it (`node server/index.cjs` with the manifest's env), lists the app's tools and reaches the
  app (`list_tabs`).
- `typecheck:renderer` 66, `tsconfig.node` 18, `typecheck:e2e` 6; unit; build; the MCP e2e specs.
- The install dialog itself is GUI-only: the operator's MacBook check is in the QA block.
