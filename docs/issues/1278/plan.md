# #1278 — the LibreChat setup snippet, fixed for LibreChat 0.8.8 (1.9.1 epic #1230)

Found by acceptance run 2 (`docs/qa/v1.9.1-acceptance.md`, "LibreChat 0.8.8"), against `release/v1.9.1` at `84dcc27`.

## What's wrong

M2's LibreChat snippet (`src/renderer/components/settings/mcpSetupSnippets.ts`) fails on LibreChat 0.8.8 in two ways:

1. `allowedAddresses: - host.docker.internal` fails 0.8.8's config schema, which requires `host:port`. An invalid
   `librechat.yaml` stops LibreChat at startup.
2. With only a static `Authorization` header, LibreChat probes the URL without it, gets Prose's (correct, RFC 6750)
   `401` + `WWW-Authenticate: Bearer`, and decides the server needs OAuth. Every tool call then fails with "OAuth
   authentication required". `requiresOAuth: false` skips that detection.

Run 2 also found that LibreChat passes a server's MCP `instructions` to the model only with `serverInstructions: true`.

## Change

- The LibreChat snippet takes run 2's working shape: `requiresOAuth: false`, `serverInstructions: true`, and
  `allowedAddresses: - "host.docker.internal:<port>"`, with the port taken from this app's endpoint. The note's
  outside-Docker variant names `<host>:<port>` too.
- Open WebUI: its fields (Type MCP (Streamable HTTP), Auth Bearer, Key; the Docker URL in the note) already match the
  config that passed run 2. No change; the test pins them.
- QA: a line under M2's block in `docs/qa/v1.9.1.md`.

## Verification

- `mcpSetupSnippets.test.ts`: the LibreChat snippet parses as YAML (`js-yaml`, already a dependency), and the parsed
  object has `requiresOAuth: false`, `serverInstructions: true`, a `host:port` `allowedAddresses` entry with the
  endpoint's port, and the Docker URL. Fails on the base.
- `typecheck:renderer` 66, `tsconfig.node` 18, `typecheck:e2e` 6; unit.

## Execution log

- **2026-11-09.** Plan `158843a`, on `release/v1.9.1` at `3f70d26`.
  - The new `mcpSetupSnippets.test.ts` case failed on the base snippet, then passed.
  - **Checked against LibreChat 0.8.8's own `configSchema`** (`librechat-data-provider` inside the co-op chat
    container, a read-only `safeParse` in a separate `node` process; nothing restarted or reconfigured). The base
    snippet is rejected: "allowedAddresses entries must include a port, for example localhost:11434 or
    [::1]:11434". The new one, and its outside-Docker variant (`localhost:<port>`), are valid, and the parsed entry
    keeps `requiresOAuth: false` and `serverInstructions: true`.
  - Open WebUI: no change; its fields match run 2's passing config, and the test pins them.
