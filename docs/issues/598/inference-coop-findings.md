# Pressure test: the hosted tier against the Inference Cooperative codebases

**Epic:** [#598](https://github.com/solo-ist/prose/issues/598) · **Date:** 2026-10-19 · **Owner:** Angel
**Amends:** [`../../architecture/adr-hosted-tier-funding-and-inference.md`](../../architecture/adr-hosted-tier-funding-and-inference.md) (Amendments 2026-10-19 b) · [`hosted-tier-plan.md`](hosted-tier-plan.md)
**Inputs:** the co-op's self-hosted Gitea, cloned to `~/Code/inference.coop/<owner>/<repo>` on 2026-10-19 — `code/member-portal` (110 commits, `app/main.py` 3,026 lines), `code/litellm` (40 commits, LiteLLM v1.103.2), `code/member-dashboard`, `code/admin-panel`, `co-op/docs` (110 commits incl. the unmerged branch `incident/2026-10-02-gateway-cve-upgrade`). Plus **live probes** against `gateway.inference.coop` on Angel's individual member key (raw captures in [`../../../gateway/scripts/fixtures/coop/`](../../../gateway/scripts/fixtures/coop/); total spend $0.07).
**Sizes** use the ADR appendix scale: S ≤ ½ day · M ≈ 1–3 days · L ≈ a week.

> **In one paragraph.** The funding decision survives intact; its reference implementation does not. The inference decision survives with three changes the ADR half-anticipated: the relay should emit a Prose-normalized stream and meter on its own, the Anthropic key becomes a *runtime* failover rather than a pre-agreement default, and model choice has to be by capability because the catalog churns and falls back across providers silently. The live probes were kinder than the code read suggested: the Anthropic-format route works with tools in both directions, three of four candidate models make valid streaming tool calls, there is no request-size ceiling below Prose's own, and thinking can be switched off per request. Nothing Prose plans is permitted under the co-op's current Terms §4, so the institutional-members policy is a gate, not a courtesy.

## Verdict

| ADR assumption | Verdict | Why | Size | Lands in |
|---|---|---|---|---|
| **D1** Open Collective funds the tier; webhook-hint → GraphQL verify → daily reconcile → grace via `expiresAt` | **Feasible as designed** | The design stands. Only the reference implementation and two query details change: the webhook payload carries no email, and the predicate must use `orders`, not `members` (§6) | S | #951 → #953 |
| **D2a** Pooled inference through Prose's gateway on an organizational membership | **Feasible with changes** | LiteLLM has teams with a pooled `max_budget` and a readable reset date; no organizations, tags or metadata, so per-user metering is entirely Prose's; budget-exceeded is a pre-stream 400 to intercept (§2, §3) | M | #1075, #848, #954 |
| **D2b** "the relay may need only a base-URL/auth swap if `/v1/messages` passes tools" | **Feasible with caveats** (code read said no; probes said yes) | `/v1/messages` is LiteLLM's translation adapter over OpenAI-compatible backends, undocumented by the co-op — but it **does** carry `tools`, `tool_use` and `tool_result` (§1). The caveats are what it drops: the gateway-computed `cost`, cached-token detail, reasoning, and per-request thinking control | S for a shortcut; M for the robust path | #954, #956 |
| **D2c** Anthropic operator key as the fallback *until the agreement exists* | **Feasible with changes** | One 2 GB Cloudron container, run largely by an AI agent, a 50-minute outage this month, "we do not guarantee uptime", and a hard pooled budget → the fallback has to be a runtime, health- and budget-triggered failover, disclosed to the user (§8) | M | [#1080](https://github.com/solo-ist/prose/issues/1080) + #955 |
| **D3** At-cost minimum from the formula | Feasible as designed | Inputs change (the catalog is cheaper than the ADR listed; the organizational rate is unknown); the formula is the formula | — | #849 |
| **D4** MAS keeps zero hosted surface | Unaffected | — | — | — |
| **D5** BYOK direct; a co-op key is the first #683 slice | Feasible as designed | Both client shapes work: Anthropic SDK + base URL (via the adapter) or an OpenAI-compatible client (§1) | M | #956 |
| "Inference runs in Tinfoil TEE enclaves" | **Not as stated** | TEE only for `tinfoil/*`; GreenPT and Regolo are policy-based; the co-op gateway sees every prompt in plaintext; API-prompt storage is unverified (§7) | S docs | #940, ADR |
| An org / app-partner arrangement is a courtesy ask | **Not as stated** | Terms §4 forbids sharing credentials and reselling or redistributing access; the institutional tier exists only in `open-questions.md` → the policy route is a **gate** (§7) | — | #957 |

Each section below runs **Reality** (co-op file:line) → **Consequence for Prose** (Prose file:line) → **Change, size, owning issue**.

## 1. The relay: `/v1/messages` is translation, and it works

**Reality.** Every entry in `code/litellm/config.yaml` uses the `openai/` provider against an OpenAI-compatible backend (Tinfoil via a local attesting sidecar at `127.0.0.1:3301`, `config.yaml:3-5`; GreenPT and Regolo over TLS). The only documented route is `POST /v1/chat/completions` (`co-op/docs/api-access.md:11`; "not Anthropic" at `:57-58`). Nothing in any repo enables, tests or mentions `/v1/messages`; it answers because LiteLLM ships an Anthropic-messages adapter by default. `drop_params: true` (`config.yaml:217`) silently drops request fields a backend doesn't accept. No model declares `supports_function_calling`; tool support is comments only (`config.yaml:60, :88`; `models.md:76`).

**Probes** (fixtures `p1-*`, `p1b-*`, `p2-*`, `p2b-*`):

| Probe | Result |
|---|---|
| Chat-completions streaming tool call with Prose's `suggest_edit` schema, `tool_choice: auto` | **3 of 4** models produced `finish_reason: tool_calls` with valid JSON arguments: `tinfoil/glm-5.3` (9 argument deltas, 104 completion tokens, 5.1 s), `tinfoil/deepseek-v4-1-flash` (9 deltas, 2.0 s), `greenpt/deepseek-v4.1-flash` (1 delta, 1.9 s). The tool-call `id` appears in the first delta only; arguments accumulate by `index`. |
| `greenpt/glm-5.3` with tools | **Fails, 3 of 3 runs:** one reasoning token, `finish_reason: stop`, no content, no tool call, even at `max_tokens: 2000`. Plain prose from the same model works (`p7f`). The model the config calls "strongest agentic model in the green tier" (`config.yaml:88`) cannot call tools through this gateway today. |
| Chat-completions tool-result round trip (assistant `tool_calls` + `role: tool` message) on `tinfoil/glm-5.3` | Works; 61 tokens, a natural-language confirmation. |
| **Anthropic-format `/v1/messages` with `tools`** on `tinfoil/glm-5.3` and `greenpt/deepseek-v4.1-flash` | **Works.** Full Anthropic event sequence: `message_start` → `content_block_start {type: tool_use, name: suggest_edit}` → `input_json_delta` × n → `content_block_stop` → `message_delta {stop_reason: tool_use, usage}` → `message_stop`. Tool input is valid JSON. |
| Anthropic-format tool-result round trip (`tool_use` block + `tool_result` block) | Works; `stop_reason: end_turn`, text reply. |
| Usage on chat-completions | Final usage-only chunk with `prompt_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens`, `prompt_tokens_details.cached_tokens` (Tinfoil adds `created_cache_tokens`), **and a gateway-computed `cost` in USD** (e.g. `0.0012100` for the glm-5.3 tool call). Non-streaming responses also carry an `impact` block (energy Wms, emissions µgCO₂e) and `inferenceTiming`. |
| Usage on `/v1/messages` | `message_start.usage` is all zeros; real counts arrive only in `message_delta.usage`. Tinfoil's cache creation is mapped to `cache_creation_input_tokens`. **No `cost` field.** |
| Reasoning | Chat-completions streams `delta.reasoning_content` (GLM, DeepSeek). On `/v1/messages` the reasoning is dropped silently — no `thinking` block, no tokens visible. Tinfoil deltas also carry a non-standard `p` key. |

**Consequence for Prose.** Today's relay pipes Anthropic SSE verbatim (`gateway/src/routes/llm/stream.ts:163-188`), rejects every block type but text (`:49-65`), and the renderer never sees the wire format: it consumes `llm:stream:chunk | thinking:delta | tool-call:start | tool-call | complete | error` (`src/main/ipc.ts:1091-1186`; the web shim dispatches the same names, `src/renderer/mocks/webApi.ts:277-320`). `useChat` sends Anthropic-style `tool_use`/`tool_result` blocks (`src/renderer/hooks/useChat.ts:674-697`), which `ipc.ts:1021-1039` already builds. So the **clients are shaped for a normalized protocol already**; only the gateway's transport is Anthropic-specific.

**Two viable paths, and the recommendation.**

| | Shortcut: `/v1/messages` adapter | Robust: chat-completions mapper + normalized events |
|---|---|---|
| Change to `stream.ts` | base URL + `Authorization: Bearer`; accept tool blocks (#1075 does this anyway) | request/response mapper (~300–400 LOC), normalized SSE events |
| Metering | tokens from `message_delta.usage`; **compute cost yourself** | tokens + `cost` + cached detail straight from the gateway |
| Thinking control | unknown whether `reasoning_effort` survives the adapter (not probed) | `reasoning_effort: "none"` verified to work (§4) |
| Support posture | undocumented route; the co-op tells SDK users "not Anthropic" | the one sanctioned route |
| Failover disclosure (§8) | needs a side channel anyway | `meta` frame is part of the protocol |
| Size | **S** | **M** |

Recommend the robust path as the end state, because metering, thinking control and disclosure all need the normalized layer anyway, and ship the normalized *protocol* in #1075 against Anthropic so most of it lands ungated. Keep the adapter as the **spike shortcut**: #952's tool-loop scoring can run tomorrow through today's relay with only the config swap and the block allowlist relaxed. For desktop BYOK (#956), the probe means the ADR's original "Anthropic SDK with a base URL" shape *does* work; an OpenAI-compatible client is still preferable for the same cost and thinking reasons.

**Where the mapper lives.** The gateway, necessarily: web mode cannot reach the co-op (CORS `https://chat.inference.coop` only, `start.sh:98`), the gateway is the single metering point, and it is the only place that sees the co-op's error bodies. The gateway is an isolated package (`gateway/tsconfig.json` `rootDir: src`, no imports from app `src/`), so the main process shares the *request-shape contract* (Anthropic-style blocks from `useChat` → chat-completions messages), not the module; a fixture-based contract test on both sides keeps them honest, with extraction to a workspace package as a Later cleanup.

**Size.** #1075 grows from M to **M–L** (normalized protocol + Anthropic→normalized mapper + web and desktop consumers + fixtures). #954's translation branch drops from L to **M**, or to S if the shortcut is taken first.

## 2. Metering: Prose's `llm_usage` is the only per-user record

**Reality.** The co-op runs one LiteLLM team per member (`team_alias: member:{email}`, `max_budget`, `budget_duration: "30d"`, `models: []` = everything, `member-portal/app/main.py:1494-1529`); keys inherit the team budget and carry no metadata (`:1597-1623`); spend is appended after each request completes; the reset date is written straight into Postgres because `/team/update` drops it (`:1549-1569`). No LiteLLM organizations, no `end_user` tagging anywhere.

**Probe** (P5). A member key can read its own key record (`GET /key/info`: `team_id`, no budget fields of its own) **and its own team** (`GET /team/info?team_id=…`: `spend 0.0241 → 0.0925` across the probes, `max_budget 15.0`, `budget_duration 30d`, `budget_reset_at 2026-10-28T14:00:00Z`, `rpm_limit null`, `tpm_limit null`, `max_parallel_requests null`). `/user/info` is 404 for a key with no user.

**Consequence for Prose.** The gateway has no meter at all (`gateway/prisma/schema.prisma` has `Entitlement`, `EntitlementInvite`, `AccessRequest`, nothing for usage). The nearest upstream fit is **one Prose team with a pooled cap and one or more keys**, and Prose reading its own pool state via `/team/info`. So `llm_usage` (owned by #1075) must be the per-user record, written per completed stream: `userId, upstream ('anthropic'|'coop'), requestedModel, servedModel, inputTokens, outputTokens, cacheReadTokens, reasoningTokens, costMicros (from the gateway's usage.cost on the co-op path, from a Prose price table on Anthropic), upstreamRequestId, aborted, createdAt`.

**Two budgets that don't compose.** The co-op's team cap is hard, pooled, and resets on a 30-day cycle anchored to the payment date; Prose's #848 quota is soft, per member, calendar month. The sum of member allowances will exceed the pool (that is the at-cost bet), so the pool can exhaust mid-cycle for everyone, including under-quota members. #848 therefore needs a **pool-level state** beside the per-member one: pool month-to-date = `SUM(costMicros) WHERE upstream='coop' AND createdAt >= poolResetAt`, with the cap and reset read from `/team/info` (verified readable) or set in config; an operator warning at 80%; a `pool_exhausted` flag raised by the 400 in §3 and cleared at reset; `Retry-After` on a pool-exhausted 429 pointing at the *co-op* reset, not month start. Overshoot by one request is inherent (spend is added after completion) and acceptable.

**Do not** send a per-user identifier upstream to get attribution: LiteLLM would record it as `end_user`, which hands a third party something Prose can't read back and doesn't need. **Size:** +S on #1075 (columns, price table), +S on #848 (pool state).

## 3. Budget exhaustion is a 400 before the stream, with co-op branding

**Reality.** `code/litellm/patch_budget_message.py` (build-time, `Dockerfile:29-30`) appends "You can add credit packs at https://opencollective.com/inference-cooperative" to LiteLLM's `Budget has been exceeded! Team=<uuid> Current cost: … Max budget: …` messages; LiteLLM raises it as `type: budget_exceeded`, HTTP 400 in this version, **before** any SSE. Not probeable on a member key (keys inherit the $15 team budget).

**Consequence for Prose.** `stream.ts:128` opens `streamSSE` *and then* fetches upstream at `:134`, so every pre-stream upstream error becomes an SSE `error` frame under an HTTP 200 (`:149-160`). The body is logged, not forwarded, so nothing leaks today — but the client cannot tell "pool exhausted" from "upstream down", and #848's 429 + `Retry-After` cannot be honored from inside an already-open 200.

**Change.** Fetch upstream first, then choose: `2xx` → open the stream; `budget_exceeded` (match on `error.type` *or* the message prefix — the patch script warns the format moves between versions) → HTTP 429 `{error: 'pool_exhausted', retryAfter}` and set the pool flag, or fail over (§8); other 4xx/5xx → 502 `{error: 'upstream_error'}`. Never forward the team UUID or the Open Collective link. #955's availability branch gets a `pool-exhausted` reason distinct from `quota-reached`. **Size:** S in #1075 (restructure), S in #954 (matcher), S in #955.

## 4. Limits the co-op does not enforce, so Prose must

**Reality.** No `rpm`/`tpm` anywhere (budget caps are the only throttle; README's "rate limits" claim is aspirational); `request_timeout: 180`, `num_retries: 2`, `TimeoutErrorRetries: 0` because a timed-out generation is still billed by Tinfoil (`config.yaml:191-219`); no `max_request_size_mb`; the Cloudron proxy's body cap undocumented; a 2 GB container.

**Probes.**

| | Result |
|---|---|
| Body cap (P3, `greenpt/glm-5.3-flash`, `max_tokens: 1`) | **No cap found.** 256 KB, 512 KB, 1 MiB and **1.5 MB** bodies all returned 200 in 14–20 s; the 1.5 MB request was 349,539 prompt tokens, of which 218,880 were served from prefix cache. Prose's own 1 MiB `bodyLimit` on `/api/llm/*` (`gateway/src/app.ts:273-277`) is the binding limit. |
| Throughput (P6, 700-token generation) | `tinfoil/glm-5.3` ≈ 133 tok/s · `greenpt/glm-5.3` ≈ 80 tok/s · `tinfoil/deepseek-v4-1-flash` ≈ 62 tok/s, time-to-first-byte 0.8–1.0 s. |
| **Reasoning eats the output budget.** | On both Tinfoil models the 700-token essay returned `finish_reason: length` with **700 reasoning tokens and zero content**. `greenpt/glm-5.3` reasoned for 31 tokens then wrote. |
| Per-request thinking control (P7) | `reasoning_effort: "none"` → 0 reasoning tokens on `tinfoil/glm-5.3` and `tinfoil/deepseek-v4-1-flash` ✔ · `chat_template_kwargs: {enable_thinking: false}` ✔ (survives `drop_params`) · Anthropic-style `thinking: {type: "disabled"}` ✘ silently dropped, reasoning continued. |

**Consequence for Prose.** Prose already enforces more than the co-op: 1 MiB body, 20 req/min per user (`config.ts:29-31`, `app.ts:280`), `MAX_MESSAGES 40`, `MAX_TOTAL_CONTENT_CHARS 200k`, `MAX_TOKENS_CAP 4096` (`stream.ts:26-33`). Gaps:

- **Timeout vs output cap.** The desktop asks for `maxTokens: 16000` (`useChat.ts:690`). On the co-op, 180 s at 60–130 tok/s is ~10k–23k tokens *including* reasoning; with thinking on, a long edit can spend its whole budget thinking. Rule for #1075: per-upstream `maxOutput` (co-op default ~6k), the relay's own upstream timeout below 180 s (e.g. 150 s total, 30 s idle), and **send `reasoning_effort: "none"` for `role: editor` requests** (the tool loop) while mapping Prose's thinking toggle to `reasoning_effort` for chat.
- **System byte cap.** Set #1075's system cap under the 1 MiB body limit (e.g. 600 KB); the co-op side is not the constraint.
- **Concurrency.** The tool loop lives in the renderer (`maxToolRoundtrips: 5`, `useChat.ts:689`); the gateway sees independent requests. Add a per-user concurrent-stream cap (1–2) beside the rpm bucket — same middleware shape as `userRateLimit` — to protect the pool and the co-op's single container from a runaway loop. S.

## 5. Model churn and the silent fallback chain

**Reality.** Five removals or replacements since September (glm-5-3-flash, deepseek-v4-flash, green-l/green-r, PublicAI; commits 3397d07, da50b04, 516167a, 9d95527); Tinfoil's deepseek and glm-flash carry "Experimental: may be deprecated with minimal notice" (`config.yaml:23-24`); a **fallback chain** `greenpt/deepseek-v4.1-flash → tinfoil/deepseek-v4-1-flash → tinfoil/gpt-oss-120b` (`:204-208`) crosses providers with different privacy posture and price, invisibly to the client; `store_model_in_db: true` means the live catalog can differ from the repo (today it matches: `GET /v1/models` returns exactly the 11 config models minus the admin-only embedding). The catalog the ADR quoted is already stale: Kimi K3 and PublicAI are gone.

**Consequence for Prose.** `ALLOWED_MODELS` is a hard-coded set of IDs (`stream.ts:26`); the desktop pins IDs in `src/shared/llm/models.ts:12-16`. If hosted clients send provider IDs, every co-op rename is a client release, and §1 shows capability is per model *and* per provider (GreenPT's glm-5.3 can't call tools; Tinfoil's can).

**Change.** A config-driven model table in the gateway: `{ alias, upstream, id, capabilities: ['tools','vision','reasoning'], maxOutput, priceIn, priceOut, role: 'chat'|'editor' }`. Hosted clients request an **alias** (`hosted-chat`, `hosted-editor`) and the gateway resolves it, records `servedModel` from the response, and surfaces it in the `meta` frame. `role: editor` points at Anthropic at #954 launch (ADR decision 5 unchanged) and flips per model as #952 scores them; from today's probes the candidates are `tinfoil/glm-5.3` and `tinfoil/deepseek-v4-1-flash`, not `greenpt/glm-5.3`. Ask the co-op (policy, #957) for a 30-day deprecation notice and either an opt-out from cross-provider fallbacks for the Prose team or the served model in a response header. **Size:** M in #1075, replacing the simpler "configurable model list" item.

## 6. The Open Collective sync: member-portal is an anti-reference

**Reality.** The portal's webhook is a secret-URL token (`POST /webhook/opencollective/{token}`, `main.py:1726-1736`), no HMAC (`README.md:90`: "if OC supports it"), and **the same token is the admin header token** (`:424-434`) — commit 1a3c602 moved other admin tokens out of URLs because URLs leak into logs; this one still sits in one. The payload has **no email** (`:1743`), so the portal maps by `data.fromCollective.slug` and finds the tier by **regex on the order description** (`:1774-1783`) because only a numeric `TierId` is present. "Active" is never checked against an order: it's `collective.members(limit: 100)` filtered by role BACKER/ADMIN and a tier name containing "membership" (`:655-681`), **no paging**, and partly forced by the bot token lacking the `orders` scope (`:105-106`). Lapse never deletes keys or zeroes the budget (`:1218-1227`, return value unused); the nightly sweep (`CloudronManifest.json:17-20` → `sweep.sh` → `/admin/sweep`) was **silently missing until 2026-10-12** (b589290) and skips entirely when the OC list comes back empty. No handling of paused, failed, cancelled or yearly orders (every `order.processed` resets the budget to now + 30 d, `:1892-1908`). Credit-pack webhook replays double-grant (no `oc_ref` dedupe, `:1809`). Only `order.processed` is acted on (`:1761-1917`), with a `firstPayment` boolean; the lapse events the code listens for (`:1919`) are never verified to exist. **Organization accounts are excluded** because they have no `Individual.email` (`:673-676`).

**What stands in our design** — every choice, validated by counter-example: webhook as hint; GraphQL verify before any grant or revoke; daily reconcile as the source of truth; grace via `expiresAt` (`gateway/src/entitlements/index.ts:11-13` already honors it; middleware untouched); `grantedBy='opencollective'` reserved and skipped by the CLI (`gateway/scripts/grant.ts:27, 150-153`).

**What changes in #951 / #953.**

1. **Identity.** Resolve the payload slug → `account(slug) { ... on Individual { email } }` with the admin token and `email` scope. The webhook body is never trusted for identity (it has none).
2. **Predicate.** `account(slug).orders(filter: INCOMING, onlyActiveSubscriptions: true, status: [ACTIVE], limit, offset)` with `tier { id slug }`, `amount`, `frequency`, `lastChargedAt`, `nextChargeDate` — needs the `orders` scope (already in #951). Tier by `tier.id`/`slug`, never by regex; the webhook's `TierId` is a hint only.
3. **Events.** Design the sync to be correct with `order.processed` + reconcile alone; keep #951's capture task for `subscription.*` / `order.payment.failed`, which are unverified.
4. **Lifecycle.** Amortize yearly; `PAUSED`/`ERROR` → grace; `CANCELLED` → grace then expire. Nothing to lift from the portal.
5. **Idempotency.** Store `ocOrderId` and the last processed activity id on `Membership`; a replayed webhook is a no-op.
6. **Organizations.** (i) A company contributing to Prose on behalf of staff cannot be mapped to a Better Auth email — out of scope for #953; document the manual `comp` grant path. (ii) **Prose contributing to the co-op as an Organization account is invisible to the co-op's own portal**, so the organizational membership will be hand-provisioned in LiteLLM by whoever operates it — #957 must ask who creates the team, how Prose reads its own spend and reset (now known: `/team/info` with the team's key), and how top-ups reach the team.

**Size** unchanged (M–L for #953); #951 gains two query shapes and loses the "reference implementation" pointer.

## 7. Terms, privacy, indemnity: what flows down

**Reality** (both documents "Last updated: October 6, 2026").

- `terms-of-service.md:58`: "Share your account credentials, or resell or redistribute access to the service." `:57`: no circumventing "usage limits, the privacy architecture, or rate limits." Members are individuals, 18+, paying through Open Collective (`:27-29`; `charter.md:15`).
- `:43`: provided "as is"; "We do not guarantee uptime or specific performance at this stage." `:96`: liability "limited to the amount of dues you have paid." `:93-98`: the member **indemnifies the co-op and Metagov** for "your use of the service, your content, your violation of law or third-party rights."
- Acceptable use `:47-60`: no regulated data (HIPAA, PCI) or GDPR Art. 9 data "unless we have agreed to that in writing"; no "sole basis for consequential decisions"; no deepfakes; no sanctioned jurisdictions.
- `privacy-policy.md:25`: usage data = "token counts, model used, and timestamps"; `:26, :42`: stored content = *chat history*, readable by the operator ("a policy commitment, not an architectural guarantee"); **silent on whether API prompts are stored**; `:62`: the provider "processes your inputs under its own terms … some in encrypted enclaves, some in the clear." Only Tinfoil is architectural (`models.md:192-200`); the gateway itself sees prompts in plaintext (`config.yaml:3-5`). Nothing in `general_settings` turns on prompt storage (`config.yaml:210-213`), but that is unverified for v1.103.2 and can only be settled by the co-op (`SELECT count(*) FROM "LiteLLM_SpendLogs" WHERE messages IS NOT NULL`).
- Institutional membership: `open-questions.md:76-80` only. The charter adopted this week leaves it to policy.

**Consequence for Prose.** `docs/privacy.md` is BYOK-only ("we never see, store, or relay your conversations") and #940 scopes only the share service; #941 scopes content policy for published documents. Both need hosted-inference sections, and both become gates for **hosted-AI** GA, not just share GA:

- **#940:** on the hosted path the prompt, including the whole open document (`buildSystemPrompt`, `useChat.ts:680-686`), travels to Prose's gateway (Render, US) → the co-op's gateway (plaintext there) → the model provider (TEE for `tinfoil/*`, policy-based otherwise). Prose stores per-user token counts, model, timestamps and cost, never content. The co-op's API-prompt storage posture: [answer from #957]. On failover, Anthropic processes the request under its API terms, and the client is told (§8). New `aiConsent.version` with this copy (#955).
- **#941 (flow-down):** 18+; the acceptable-use list mirrored; no sharing of hosted access; "as is", no uptime; the user indemnifies Prose for their content to the extent Prose indemnifies the co-op and Metagov — **a legal judgement for Angel, flagged, not drafted here.**
- **#957 (policy asks):** a *written* carve-out to §4 for institutional members (the ask is a Terms change decided through Loomio, not a wink); a sentence in their privacy policy on API-prompt storage; the deprecation notice (§5); whether the regulated-data prohibition flows to Prose's users or Prose takes it on in writing.

## 8. Ops reality → the fallback is a runtime failover

**Reality.** One Cloudron container (2 GB, `CloudronManifest.json`), one Postgres, a Tinfoil sidecar started with `&` and never supervised (`start.sh:164-178`). The 2026-10-02 incident (`co-op/docs` branch `incident/2026-10-02-gateway-cve-upgrade`, unmerged, authored by "InferenceBot"; `code/litellm/README.md:101-119`): a floating image tag moved, forced a full Prisma migration, OOM-killed at the 256 MB default, crash-looped on a missing migrations ledger — about 50 minutes down; the same upgrade **silently reverted CORS to `*`**. It fixed CVE-2026-35029 and CVE-2026-59822 (CISA KEV). Upgrades expect a 15–20 minute window (`README.md:96-99`). Operations are substantially an AI agent's ("Inferencebot's own Cloudron access", `operator-token-runbook.md:8-19`); announcements go to Matrix `#inferencebot-updates` (`getting-started.md:114-119`); support is info@inference.coop; there is no on-call and no uptime commitment.

**Probe** (P4). `/health/liveliness` ("I'm alive!") and `/health/readiness` (`{"status":"healthy","db":"connected"}`) answer **without auth**; `/health` is 401.

**Consequence for Prose.** The ADR's fallback is a *state* ("until the agreement exists"); it has to be a *behaviour*. The relay needs two upstreams configured at once and a router:

- `LLM_UPSTREAMS` with two entries (`coop` bearer, `anthropic` x-api-key); per-upstream circuit breaker (N consecutive connect errors / 5xx / timeouts in a window opens it for T minutes; half-open probe), also tripped by `pool_exhausted` (§3).
- Routing: alias → preferred upstream (§5 table) → if the breaker is open, the alias's `fallback` (an Anthropic model of matching capability). Refuse rather than fail over when `LLM_FAILOVER=off` or when the user has declined Anthropic processing (a per-user setting in #955, default on, disclosed in consent).
- Disclosure: first SSE frame `meta { upstream, servedModel }`; `llm_usage.upstream`; #955 shows "served by Anthropic (co-op unavailable)".
- Health: poll `/health/readiness` every 60 s to drive the half-open transition, never as the sole input.
- Ops: subscribe to `#inferencebot-updates`; expect 15–20 min upgrade windows; a runbook line "co-op down → confirm breaker open → nothing to do" (fold into #957's checklist).

**Size** M, as its own issue — [#1080](https://github.com/solo-ist/prose/issues/1080) — so #954 stays "the flip". Tests: `gateway/scripts/mock-upstream.mjs` gains a second port and fault injection (timeouts, the budget 400 body, 503).

## 9. Still unverified, and the cheapest test for each

| # | Question | Status / cheapest test | Blocks |
|---|---|---|---|
| 1 | Chat-completions tool round trip on co-op models | **Done** (§1): 3/4 pass; `greenpt/glm-5.3` fails. Fixtures `p1-*`, `p1b-*`. | #954 mapper, #956 |
| 2 | `/v1/messages` with tools and tool results | **Done** (§1): works. Fixtures `p2-*`, `p2b-*`. | #954 shortcut, #956 |
| 3 | Usage shape, cached tokens, `cost`, served model | **Done** (§1, §2): chat-completions has all four; `/v1/messages` lacks `cost`. | #1075 meter |
| 4 | Body cap | **Done** (§4): none found to 1.5 MB. Fixtures `p3-*`. | #1075 system cap |
| 5 | Health endpoints without auth | **Done** (§8): liveliness/readiness public. | failover |
| 6 | Pool spend / reset readable by the team's key | **Done** (§2): `/team/info?team_id` works. | #848 |
| 7 | Thinking control per request | **Done** (§4): `reasoning_effort: "none"` and `chat_template_kwargs` work; Anthropic `thinking` is dropped. Not tested on `/v1/messages`. | #1075 editor role |
| 8 | Throughput per model | **Done** (§4). | #1075 `maxOutput` |
| 9 | Budget-exceeded status and body | Not probeable on a member key. Read LiteLLM v1.103.2 `proxy/auth/auth_checks.py`; match on type/message, not status. | §3 matcher |
| 10 | Does the co-op store API prompts in spend logs | One SQL the co-op runs, or a confirmation that `store_prompts_in_spend_logs` is unset in the live `/app/data/config.yaml`. **Policy ask.** | #940 |
| 11 | Full 5-turn `suggest_edit` loop scored on `tinfoil/glm-5.3` and `tinfoil/deepseek-v4-1-flash` with `reasoning_effort: "none"` | Drive the desktop loop through a dev gateway pointed at the co-op; score valid JSON, position-sorted multi-edit, wall time per turn. **This is #952's remaining technical work.** | `role: editor` flip |
| 12 | Does `reasoning_effort` survive the `/v1/messages` adapter | One curl. Only matters if the shortcut path is kept. | #956 |
| 13 | Organizational terms: rate, allowance, team provisioning for an Organization account, deprecation notice, fallback opt-out or served-model header, API-prompt statement, Terms §4 carve-out | Human, #957, after the institutional-members policy. | #954 |

Go / no-go for #952 reduces to three questions: (a) the mapper is viable on the captured fixtures — **yes**; (b) a co-op model drives `suggest_edit` reliably for `role: editor` — **open, item 11**; (c) organizational terms — **open, item 13**.

## 10. Amendments

**ADR** (`docs/architecture/adr-hosted-tier-funding-and-inference.md`) — a dated amendment block "2026-10-19 (b)" plus in-place markers: the Context co-op bullet (`/v1/messages` is LiteLLM's adapter and works with tools; TEE only Tinfoil, plaintext at the gateway; catalog refresh; no rate limits, 180 s timeout, no uptime, single container); Decision 2 (normalized events; runtime failover); Decision 5 (either client shape works); Options A (strike "may need only a base-URL swap" → "a base-URL swap works for the spike; the normalized relay is the end state"); the trade-off row on privacy; Risks 6–8; the code-impact rows; Open Questions and Human Asks; Corrections.

**Plan doc** (`hosted-tier-plan.md`) — a "Verified against the co-op code" table; Lane S's #952 row → §9 items 11–13; Lane B's #1075 row → protocol + mapper + alias table + caps + usage columns + fetch-before-stream (M–L, the long pole); #848 → pool state; #954 → mapper default, budget matcher, alias flip; a new failover row gated on #1075 only; the `/v1/messages` open question replaced.

**Issues** — #952 (scope = §9 table + the three questions; fixtures dir), #954 (mapper default; budget matcher; alias flip; acceptance "co-op 400 → Prose 429 with no co-op text"), #1075 (protocol v1, Anthropic→normalized mapper, consumers, alias table, per-upstream caps, concurrency, usage columns, fetch-before-stream), #951 / #953 (§6), #848 (§2), #957 (§7 asks + ops runbook line), #956 (either client; prefer OpenAI-compatible), #955 (consent + failover setting + `pool-exhausted` / `served-by-fallback` states), #940 / #941 (§7; hosted-AI GA gates), #766 (web consumer builds on #1075's protocol). **New issue:** [#1080](https://github.com/solo-ist/prose/issues/1080) `feat(gateway): upstream health routing + pool-exhausted failover` (§8).

## 11. What this does not change

The Open Collective funding rail and email as the join key · the sync shape (hint → verify → reconcile → grace) and the untouched middleware (`entitlements/index.ts`, `middleware/entitlement.ts`) · `requireSession → requireEntitlement('ai_proxy') → rateLimit` before any upstream connection (`app.ts:272-282`) · the Anthropic operator key as the shipped state, now also the runtime fallback · MAS zero hosted surface · BYOK direct and unmetered · web mode through Prose's gateway (CORS) · the at-cost formula and the provisional $10 / $15 · #848 load-bearing · #939 open · fiscal hosts asked in parallel · the #1074 / #1075 split and the Lane B order (#1059 → #1074 → #1075 → #848 → #955) · agentic editing on Anthropic until a co-op model is scored, now expressed as the `role: editor` alias.

## Appendix A — the catalog as of `config.yaml` (and `GET /v1/models`, 2026-10-19)

USD per token, input / output / cached input. Tool-capable **as probed**, not as documented.

| Model | Provider · privacy | In / Out / Cached | Tools (probe) | Notes |
|---|---|---|---|---|
| `greenpt/deepseek-v4.1-flash` (default) | GreenPT · policy, EU renewable | 2.2e-7 / 1.1e-6 / 1.1e-8 | ✔ | falls back to Tinfoil then gpt-oss |
| `tinfoil/deepseek-v4-1-flash` | Tinfoil · TEE | 6.5e-7 / 1.45e-6 / 1.3e-7 | ✔ | "may be deprecated with minimal notice"; reasoning on by default |
| `tinfoil/glm-5.3` | Tinfoil · TEE | 1.8e-6 / 5.75e-6 / 4.5e-7 | ✔ | fastest (≈133 tok/s); reasoning on by default |
| `tinfoil/gpt-oss-120b` | Tinfoil · TEE | 1.5e-7 / 6e-7 / — | not probed | 131K context |
| `greenpt/glm-5.3-flash` | GreenPT · policy | 1.1e-7 / 4.4e-7 / 2.2e-8 | not probed | used for the body-cap test |
| `greenpt/glm-5.3` | GreenPT · policy | 1.1e-6 / 4.4e-6 / 2.75e-7 | **✘** (3/3) | prose generation fine |
| `regolo/apertus-70b` | Regolo · policy + zero retention | 4.6e-7 / 2.44e-6 / — | not probed | 65K context |
| `regolo/qwen3.5-122b` | Regolo · policy + zero retention | 1.16e-6 / 4.87e-6 / — | not probed | thinking forced off in config |
| `regolo/qwen-image`, `tinfoil/whisper-large-v3-turbo`, `tinfoil/voxtral-tts` | — | per pixel / 5e-8 / 0 | — | image, audio |
| `tinfoil/nomic-embed-text` | Tinfoil | 5e-8 | — | admin team only; not in member `/v1/models` |

Global: `drop_params: true`, `request_timeout: 180`, `num_retries: 2`, timeouts never retried. No capability or context-window flags in config; the context numbers in `models.md` come from elsewhere.

## Appendix B — what the co-op's own dashboard reads

Members never call LiteLLM directly; the dashboard asks the portal's "broker" (`member-dashboard/app/main.py:116-133`, shared secret + `X-Member-User` header — internal, not something to depend on). `/broker/usage` (`member-portal/app/main.py:2775-2787`) returns `{email, balance, allowance, credits, credits_remaining, spend, all_time_spend, remaining, total_tokens, reset_at, models:[{model, spend, tokens, calls}]}`, read straight from `LiteLLM_TeamTable` and an aggregate over `LiteLLM_SpendLogs` (`model_group, model, spend, total_tokens, startTime, team_id`, `:295-305`), with a `/spend/logs` fallback that must filter by `team_id` client-side because the server doesn't reliably (`:2809-2824`). No per-request records, per-key splits, or input/output token split are exposed to members. For Prose the relevant read path is simpler: `/team/info` on its own key (§2).

## Appendix C — nuances against the first code read

1. The code read concluded `/v1/messages` was "translation, not passthrough" and therefore unusable without a mapper. The probes show the translation *works* for tools in both directions. The recommendation (normalized protocol + chat-completions mapper) stands on metering, thinking control and disclosure grounds, not on the adapter being broken.
2. LiteLLM *can* record a per-request `user` as `end_user` and does have organizations; the co-op doesn't use either. Not tagging users upstream is a deliberate privacy choice for Prose, not a constraint.
3. `budget_exceeded` is HTTP 400 in this LiteLLM version; 429 is the rpm/tpm path the co-op doesn't configure. Match on type or message, never status.
4. The ADR's "2 MB system prompt" probe was moot above 1 MiB because Prose's own body limit sits there; the co-op accepted 1.5 MB anyway.
5. The portal's `members()`-based predicate is partly forced by its bot token lacking the `orders` scope — exactly why #951 lists that scope.
