# #1139 — Dev instance takes over the real Prose's MCP socket

Issue: https://github.com/solo-ist/prose/issues/1139 (found 2026-10-31 while moving the 1.9.0 QA pass onto the dev
server). Branch `issue-1139-mcp-socket-path` from `release/v1.9.0`; **touches `src/main/**`, so the security gate
routes it to the operator's review**; one PR. Last item of tranche 3 (2026-11-04).

## Mechanism, confirmed

`src/main/mcp/socket-server.ts` computed `SOCKET_DIR` / `SOCKET_PATH` as module-level constants from
`app.getPath('userData')`. `src/main/index.ts` redirects userData to `getUserDataPath()` (the `Prose Dev` profile
in dev, `PROSE_USER_DATA_DIR` for the e2e seam) after the hoisted imports have run, so the socket landed in the
default profile (`…/Application Support/prose`, the installed app's folder on a case-insensitive volume): the dev
instance unlinked the installed app's socket and listened there, and so did every e2e launch on this machine.
Packaged builds were unaffected (their default userData is already the right one).

## Change

The path is resolved when it is used: a `socketPath()` function over `app.getPath('userData')`, called in
`getSocketPath()`, `start()` and `stop()`. No other module computes it; `src/mcp-stdio/index.ts` derives the
installed app's path on its own and is unchanged, so a dev instance's socket (`Prose Dev/prose.sock`) is reachable
only by an stdio server pointed at it on purpose.

## Tests

`e2e/electron.mcp-socket-path.spec.ts` (new): launched with `PROSE_USER_DATA_DIR`, the socket file appears under
that profile and the main process reports the same userData. Falsified on a build of the branch base: there the
socket goes to the default profile and the file under the seeded one never appears.

## Execution log

- 2026-11-04: inventory (above).
