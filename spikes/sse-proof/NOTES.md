# Spike #775 — SSE-through-Hono: decision note

**Verdict: CONFIRMED.** Anthropic's `text/event-stream` relays cleanly through a Hono
`streamSSE` proxy on `@hono/node-server`, with no buffering, working abort
propagation, and error frames intact. The renderer's existing streaming contract is
untouched. **The Phase 0/1 gateway architecture is safe to build on this.**

## What was proven

Run it with `bash spikes/sse-proof/run-spike.sh` (add `ANTHROPIC_API_KEY` to also hit
the real API; without it, `mock-upstream.mjs` replays a representative token stream).

Latest run (mock upstream): **15/15 checks passed.**

1. **Order preserved** — `message_start → content_block_start → ping →
   content_block_delta×N → content_block_stop → message_delta → message_stop`
   all relay in order with the correct `event:`/`data:` framing.
2. **No buffering** — first `content_block_delta` arrived at **62 ms**, well before the
   stream ended at **1345 ms** (22 tokens). Tokens flush incrementally, not in a batch.
3. **Abort propagation** — a client disconnect fires `stream.onAbort()`, which aborts the
   upstream `fetch()` `AbortController`; the mock upstream observes `req.on('close')`.
   The stream is cut at the token where the client left (verified: cut at token 3 of 22).
4. **CORS** — localhost origins are reflected; non-localhost origins get `null` (no
   wildcard). OPTIONS preflight handled.

## Renderer contract — unchanged

The eventual web `llmChatStream()` rewrite (Phase 1 / #766) POSTs to `/api/llm/stream`,
consumes these SSE frames, and re-dispatches the existing `llm:stream:*` window events
(`src/renderer/lib/browserApi.ts` → `useChat`). `useChat` needs no changes — the wire
shape here matches that protocol.

## What lifts into the real gateway (#765)

- The `reader.read()` relay loop with the `leftover` buffer for SSE frame parsing.
- `stream.onAbort(() => abortController.abort())` — the client-disconnect → upstream-abort chain.
- Upstream non-200 / fetch-throw → write an `error` event → return.
- CORS middleware (add `prose.solo.ist` to the allowlist).

Throwaway (not carried forward): the `USE_REAL_ANTHROPIC` / `UPSTREAM_URL` toggles,
`mock-upstream.mjs`, per-token `console.log`, and `.mjs` (the gateway is TypeScript).

## Deploy caveat discovered (feeds #765 / Stage A.5)

**Render buffers `text/event-stream` by default.** The production stream route must set
**`X-Accel-Buffering: no`** (plus `Cache-Control: no-cache`, `Connection: keep-alive`) and
flush headers immediately, or the stream only surfaces once complete. Render allows
100-minute responses, so long generations aren't cut — just tune Node
`server.keepAliveTimeout` / `headersTimeout`. This is validated on real Render infra in
the Stage A.5 go/no-go gate before the gateway is built.

Refs #775 #765 #598
