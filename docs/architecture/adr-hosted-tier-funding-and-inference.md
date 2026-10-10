# ADR: Hosted-Tier Funding via Open Collective, Hosted Inference via Inference Cooperative

**Status:** Proposed
**Date:** 2026-09-29
**Deciders:** Angel (maintainer)
**Scope:** Track C — Paid Platform Foundation / the Web Epic ([#598](https://github.com/solo-ist/prose/issues/598)). This file lives on `main`; the two docs it amends live on the `web-foundations` integration branch until that branch graduates (links below point at the branch). Amends [`operating-model.md`](https://github.com/solo-ist/prose/blob/web-foundations/docs/architecture/operating-model.md) (rev 2, on `web-foundations`) and [`web-platform.md`](https://github.com/solo-ist/prose/blob/web-foundations/docs/architecture/web-platform.md) §6–§9. Supersedes the "unwired Stripe skeleton" in [#770](https://github.com/solo-ist/prose/issues/770).

> **Summary.** The hosted tier is funded by an **Open Collective recurring contribution** (the public ledger is the pricing page) instead of a future SaaS billing layer, and hosted inference is **pooled through the Prose gateway on a negotiated organizational membership with Inference Cooperative** (inference.coop), with the Anthropic operator key as the fallback until that agreement exists. The tier minimum is set strictly from the at-cost formula. The Mac App Store build keeps **zero hosted surface**. BYOK stays direct. Issues: [#951](https://github.com/solo-ist/prose/issues/951)–[#957](https://github.com/solo-ist/prose/issues/957).

## Context

Prose's hosted features — the gateway, capability-link sharing with live comment sync (Web W1, live on `api.prose.solo.ist` / `share.prose.solo.ist`), and the planned web editor with a gated LLM proxy (W3) — need a funding rail and an inference source that fit the project's principles: file-as-truth, local-first, privacy-preserving, no lock-in, transparent, and "a co-op, not a profit center" ([`../roadmap.md`](../roadmap.md), Distribution & Monetization).

What exists on `web-foundations` today (verified 2026-09-29 @ `ba45e3f`):

- **Identity:** Better Auth magic-link ([#601](https://github.com/solo-ist/prose/issues/601)); `User.email` is unique (`gateway/prisma/schema.prisma:49`). There is no Auth0 and never was — the Cowork brief's premise was wrong.
- **Entitlements:** `Entitlement { userId, feature, grantedBy = 'manual', grantedAt, expiresAt?, notes? }` (`schema.prisma:22-34`), gated by `requireEntitlement(feature)` after `requireSession` (`gateway/src/middleware/entitlement.ts`); `hasEntitlement` already honors `expiresAt` (`gateway/src/entitlements/index.ts:13-20`). Features: `ai_proxy`, `share_publish`. Grants are manual (`npm run seed:ai-proxy`). **No billing code exists to remove**; [#602](https://github.com/solo-ist/prose/issues/602) only reserved a `granted_by` seam plus an *unwired* Stripe skeleton for [#770](https://github.com/solo-ist/prose/issues/770).
- **LLM proxy:** `POST /api/llm/stream` relays Anthropic SSE verbatim to `${upstreamBase}/v1/messages` with the operator's key (`gateway/src/routes/llm/stream.ts`). It accepts text blocks only, allows two Claude models, caps `system` at 8,000 characters and output at 4,096 tokens. No `llm_usage` meter, no cron, no webhook routes, no `/api/account/*`.
- **Clients:** the renderer consumes normalized `llm:stream:*` events (`src/main/ipc.ts:1085-1180`); the Anthropic wire shape leaks only on the request side (`src/renderer/hooks/useChat.ts:291-319`, `ipc.ts:1015-1033`). The web build runs `src/renderer/mocks/webApi.ts`, whose `llmChatStream` is a stub; [#766](https://github.com/solo-ist/prose/issues/766)'s client wiring has not landed. `Settings.llm.provider` is the literal `'anthropic'` (`src/renderer/types/index.ts:63`).
- **MAS posture:** `webPlatform` is forced off on MAS (`src/renderer/lib/featureFlags.ts:59,71`) and every `share:*` write handler returns `MAS_SHARE_BLOCKED` (`ipc.ts:1744+`).

External facts that constrain the decision (all verified 2026-09-29; see References):

- **Inference Cooperative** is a member-governed co-op: an Open Collective collective fiscally hosted by **Metagov**, 26 contributors, ~$3.9k/yr budget; membership is a $10–20/mo sliding scale (tier minimum $10) for a **$15/mo token allowance per member**, shared across chat and API, plus non-expiring credit packs. Its terms prohibit sharing credentials or reselling access. The API is LiteLLM at `https://gateway.inference.coop/v1` (OpenAI-compatible; an Anthropic-format `/v1/messages` route also answers — 401 without a key vs a clean 404 for a fake route). **Browser CORS is refused** for `https://prose.solo.ist`. Tool-capable, streaming models with list prices per million tokens: GLM-5.3 $1.80/$5.75, GLM-5.3-flash $0.40/$1.25, DeepSeek V4.1 flash $0.65/$1.45, Kimi K3 $4/$20, GreenPT GLM-5.3 $1.10/$4.40, Apertus 70B $0.82/$2.92. Inference runs in Tinfoil TEE enclaves (attestable); "we do not train on your data"; metering metadata (tokens, model, timestamps) is logged. Their own `member-portal` syncs Open Collective members to LiteLLM keys via an `order.processed` webhook, an email map and a daily sweep.
- **Open Collective:** GraphQL v2 at `https://api.opencollective.com/graphql/v2`, authenticated with a `Personal-Token` header (scopes `orders`, `email`, `account`, …). `Account.members(email:)` is an admin-only filter "useful to check if a member exists"; `orders(onlyActiveSubscriptions: true, tier, amount)` returns `status` (`ACTIVE` = recurring with up-to-date payments; `CANCELLED` after contributor cancel or repeated failures; `PAUSED`; `ERROR`), `frequency`, `amount`, `tier`, `lastChargedAt`, `nextChargeDate`. Webhook activities include `order.processed`, `order.payment.failed`, `subscription.activated/canceled/paused/resumed`, `collective.member.created`, `contribution.refunded`; payload shape and signing are **not publicly documented**. Tiers with minimum amounts are standard. Collectives pay no platform fee; fiscal hosts charge 4–10%; processor fees pass through.
- **Fiscal hosts:** Metagov (501(c)(3), fee per agreement, policy requires a Metagov Research Director to lead or sponsor the project); Open Source Collective (10% flat, 501(c)(6), MIT + org repo qualify, but its guidance excludes "funds for services or business transactions that directly benefit an individual or customer"); an independent collective needs its own legal entity, which `operating-model.md` §2.4 rules out.
- **Apple:** guideline 3.1.3(a) "Reader" apps covers only magazines, newspapers, books, audio, music and video. 3.1.3(b) Multiplatform Services allows access to items bought elsewhere "provided those items are also available as in-app purchases within the app." The US storefront is now exempt from anti-steering, which is moot if the MAS build has no hosted surface.

## Decision

1. **Funding runs through an Open Collective recurring contribution.** Access to the hosted tier is granted by an active contribution to the Prose collective at or above the tier minimum, keyed on the contributor's **email** (already the Better Auth identity). The gateway writes `Entitlement.grantedBy = 'opencollective'` rows from a sync that treats OC webhooks as hints, re-verifies via GraphQL, and reconciles daily; a lapse degrades through a grace period via the existing `expiresAt` — never an instant 403. Every operating cost (Render, Postgres, Resend, R2, the co-op membership) is a public OC expense, so **the collective page is the pricing page**. The Stripe seam in #770 is dropped.
2. **Hosted inference is pooled through the gateway on a negotiated organizational membership with Inference Cooperative.** Prose meters per-member allowances ([#848](https://github.com/solo-ist/prose/issues/848) becomes load-bearing). **Gate:** the co-op must agree to an organizational / app-partner arrangement (its ordinary terms forbid pooling). **Fallback:** until then the proxy keeps the Anthropic operator key exactly as today, so nothing in W1 or desktop GA blocks on this. Web mode goes through Prose's gateway either way (the co-op gateway refuses browser CORS).
3. **The tier minimum is set strictly from the at-cost formula** — `price ≈ member's metered co-op inference cost (at the org rate) + fixed infra ÷ active members + small variance buffer`, never profit. **$10/mo minimum and $15/mo suggested are the provisional outputs** (moderate and heavy member at launch scale, rounded slightly up per the SourceHut principle already adopted), set on the OC tier and recomputed quarterly against the ledger. They are outputs, not inputs; mirroring the co-op's numbers is not the rule.
4. **The Mac App Store build carries no hosted features, sign-in, or membership links.** This is already the code's posture; the docs' "reader-app pattern" framing is retired because 3.1.3(a) does not cover Prose and 3.1.3(b) would demand IAP parity. Hosted surfaces compile out of MAS the way reMarkable does (`IS_MAS_BUILD` + flags).
5. **BYOK stays direct.** The existing "no gateway for bring-your-own-key" decision stands; a user's own Inference Cooperative key becomes the first [#683](https://github.com/solo-ist/prose/issues/683) slice on desktop ([#956](https://github.com/solo-ist/prose/issues/956)), never metered. Agentic editing stays on Anthropic until the spike shows a co-op model drives the `suggest_edit` tool loop reliably.
6. **[#939](https://github.com/solo-ist/prose/issues/939) (who can publish at GA) stays open.** If it lands on option C, OC membership is the mechanism (`share_publish` via the same sync). The beta remains a waitlist.

## Options Considered

### Funding rail

| Option | Assessment |
|---|---|
| **A. Open Collective recurring contribution (chosen)** | Public ledger for free; tiers with minimums; email is the join key; webhook + GraphQL API; a fiscal host supplies the legal entity Prose deliberately doesn't form. Costs: host fee 4–10%, undocumented webhook signing (mitigated by verify-on-receipt + reconcile), a fiscal-host policy question about contributions-for-access. |
| B. Stripe / SaaS billing (the #770 seam) | Lowest fees, signed webhooks, mature. But it is the profit-center shape the roadmap rejects, needs a legal entity and tax handling Prose doesn't have, and a second transparency mechanism would have to be built on top. |
| C. Apple in-app purchase | Ruled out twice already (no StoreKit IAP; usage-based metering fits IAP badly; 15–30% fee). Would also force hosted features *into* MAS. |
| D. Pay-what-you-want with no minimum | Maximally open, but the pooled inference allowance has a real per-member cost; with no floor the ledger can't stay at-cost. A "custom amount" tier remains available for donations. |

### Hosted inference source

| Option | Assessment |
|---|---|
| **A. Pooled through the gateway on a co-op organizational membership (chosen)** | Values-aligned (member-governed, TEE-private, no training on data), one metering point, the existing relay may need only a base-URL/auth swap if `/v1/messages` passes tools. Requires an agreement the co-op hasn't offered yet; quota becomes load-bearing; tool quality on open models unproven. |
| B. Member-key (every hosted user joins the co-op) | No inference cost for Prose, no ToS conflict, cleanest privacy story. Rejected for now: doubles the sign-up friction (two memberships), and web mode still needs Prose's proxy to pass the key (CORS), which is a gateway in the BYOK path. Kept as the desktop BYOK slice ([#956](https://github.com/solo-ist/prose/issues/956)). |
| C. Anthropic operator key (status quo) | Zero change, best tool-calling quality. Rejected as the end state (ledger would fund a hyperscaler, no governance seat), **retained as the fallback**. |
| D. OpenRouter or other aggregators | Broad catalog, but it is a commercial middleman with its own logging posture; it reintroduces the multi-provider surface Prose removed. Deferred behind the same provider seam (#683). |

### Fiscal host

Metagov first (already hosts the co-op; a Nathan Schneider conversation; 501(c)(3)), Open Source Collective second (10%, but confirm contributions-for-access is acceptable), independent collective not viable without an entity. Decision deferred to the human checklist ([#957](https://github.com/solo-ist/prose/issues/957)).

## Trade-off Analysis

| Dimension | OC + pooled co-op (chosen) | Stripe + Anthropic key | OC + member-key |
|---|---|---|---|
| Fits "co-op, not a profit center" | Yes — ledger is public, provider is member-governed | No | Yes |
| Legal entity needed | No (fiscal host) | Yes | No |
| Code delta to reach a paid hosted tier | M–L (OC sync + meter + gating; relay swap likely M) | M (Stripe webhooks + meter) | M (sync + gating), no meter |
| Blocked on a third party | Co-op agreement (fallback exists) | No | No |
| Tool-calling quality for agentic editing | Unproven on co-op models; Anthropic fallback | Best | Unproven |
| Privacy of hosted prompts | TEE enclaves, attestable | Anthropic API terms | TEE enclaves |
| User friction | One membership | One subscription | Two memberships |

## Consequences

**Positive**
- No billing system to build or operate; the ledger and the pricing page are the same artifact, which is what makes "anti-extractive" credible.
- The entitlement model already fits: `grantedBy` + `expiresAt` give the payment rail and the grace period without a middleware change.
- A member-governed, enclave-private upstream matches the privacy posture better than a hyperscaler key, and the gateway remains the single metering point.
- Desktop GA of sharing (#945) is not blocked: the fallback keeps today's gateway behavior.

**Negative**
- Two external dependencies gain leverage: the fiscal host's policy and the co-op's willingness to sell an organizational allowance.
- Pooled inference makes the soft quota (#848) mandatory before the hosted AI tier opens; the meter doesn't exist yet.
- The at-cost minimum will move with membership count and the org rate; the OC tier has to be edited when the formula moves (quarterly, published).
- Open-model tool calling may not clear the bar for `suggest_edit`; the ADR keeps Anthropic for agentic editing until proven, which means two upstreams in the relay for a while.

**Risks**
1. **The co-op says no, or prices the allowance above list.** Mitigation: the Anthropic fallback is the shipped state; the BYOK co-op key ships regardless; the ask is raised early (#957) and the spike (#952) measures before any build.
2. **Fiscal-host policy treats contributions-for-access as a sale.** Mitigation: ask before applying; the questions are enumerated in #957; Open Source Collective is the fallback host; no agent gives tax conclusions.
3. **Unsigned OC webhooks.** Mitigation: the webhook only nudges; grants and revocations happen after a GraphQL verification; a daily reconcile job is the source of truth.
4. **Tool-loop quality on co-op models.** Mitigation: scored in #952 against `tinfoil/glm-5-3`, `deepseek-v4-1-flash`, `greenpt/glm-5.3`; agentic editing stays on Anthropic until it passes.
5. **Docs and issues that still say "Stripe" or "reader-app".** Mitigation: fixed in this change (roadmap, web-platform, operating-model, handoff, gateway README, #770/#771/#598 bodies).

## Code-Impact Appendix

Line numbers are on `web-foundations` @ `ba45e3f`. Sizes: S ≤ ½ day, M ≈ 1–3 days, L ≈ a week.

| Area | Files | Size | Issue |
|---|---|---|---|
| Gateway upstream swap (config + relay + tests) | `gateway/src/config.ts:15-17,95-101,170-174`, `gateway/src/routes/llm/stream.ts`, `gateway/scripts/test-gateway.mjs`, `gateway/scripts/mock-upstream.mjs`, `gateway/render.yaml` | M | #954 |
| Tools + system cap through the relay | `stream.ts:26-33` (caps), `:49-65` (block allowlist), `:113-126` (upstream request) | M if `/v1/messages` passthrough; L if OpenAI translation + normalized SSE | #954 |
| `llm_usage` write-only meter | `stream.ts:163-188`, `gateway/prisma/schema.prisma` + migration | M | #954 |
| OC entitlements: `Membership` model, webhook route, reconcile cron, `databaseHooks` grant, entitlements endpoint, revoke CLI, tests | `schema.prisma`, `gateway/src/app.ts:84-107`, new `gateway/src/routes/webhooks/opencollective.ts`, new `gateway/scripts/reconcile-oc.ts`, `gateway/src/auth/index.ts:12-36`, `gateway/src/config.ts`, `render.yaml`, new `gateway/scripts/test-oc.mjs`, `.github/workflows/gateway.yml` | M–L | #953 |
| Soft quota + usage read path | `gateway/src/middleware/entitlement.ts`, renderer toast | M | #848 |
| Web client + account store + sign-in | `src/renderer/mocks/webApi.ts:270-296,572-575`, new `src/renderer/lib/gatewayClient.ts`, new account store, Settings web sign-in | M | #766 |
| AI availability hosted branch | `src/renderer/lib/llm.ts:80-115`, `src/renderer/hooks/useAIConfigured.ts:12-19`, `src/renderer/components/AIConsentDialog.tsx:103` | S | #955 |
| Gating + membership UI (`hostedInference` flag, `account:*` IPC, Settings Account section, lapsed states, menus) | `src/renderer/lib/featureFlags.ts:57-73`, `src/main/ipc.ts:1744+`, `src/preload/index.ts:299-315,606-630`, `src/renderer/types/index.ts`, `SettingsDialog.tsx:729-734`, `ShareDialog.tsx:182-221`, `src/renderer/stores/shareStore.ts:52-66`, `src/main/menu.ts:370`, `Toolbar.tsx:344-349` | M | #955 |
| Desktop BYOK co-op key | new credential + IPC (pattern `src/main/ipc.ts:1389-1400`), `src/renderer/types/index.ts:63`, `src/shared/llm/models.ts:12-36`, `src/main/ipc.ts:1001` provider branch, Settings AI tab | M | #956 |
| Docs | `docs/roadmap.md`, `operating-model.md`, `web-platform.md`, `docs/handoff/solo-prime-web-epic.md`, `gateway/README.md`; later `docs/privacy.md` (#940) | S | this PR + PR to `web-foundations` |

## Proposed Issues (filed 2026-09-29)

| Issue | Title | Depends on | Wave / board |
|---|---|---|---|
| [#951](https://github.com/solo-ist/prose/issues/951) | spike(web): Open Collective membership → entitlement check | — | Spikes · Do Next |
| [#952](https://github.com/solo-ist/prose/issues/952) | spike(llm): Inference Cooperative as the hosted upstream | human ask in #957 | Spikes · Do Next |
| [#953](https://github.com/solo-ist/prose/issues/953) | feat(gateway): Open Collective-backed entitlements, reconcile job, grace period | #951, #813 | W3 · Later (GA if #939 = C) |
| [#954](https://github.com/solo-ist/prose/issues/954) | feat(gateway): swap the hosted LLM upstream to Inference Cooperative | #952 go, #766 | W3 · Later |
| [#955](https://github.com/solo-ist/prose/issues/955) | feat(app): hosted-features gating and membership UI | #953 endpoint | W3 / GA · Later |
| [#956](https://github.com/solo-ist/prose/issues/956) | feat(llm): bring-your-own Inference Cooperative key on desktop | #952 | Later (#683) |
| [#957](https://github.com/solo-ist/prose/issues/957) | ops: stand up the Prose Open Collective + co-op organizational membership (human) | — | Do Next |

Existing issues amended: #770 (retitled; Stripe seam dropped), #848 (load-bearing), #849 (OC page is the ledger), #766 (upstream may be the co-op), #683 (first slice #956), #939 (option C mechanism), #598 (epic summary), #771 (reader-app correction), #942 (revoke CLI lands in #953).

## Open Questions

- Will the co-op offer an organizational allowance, at what rate, and can LiteLLM teams scope a Prose key? (#957 → #952)
- Does `/v1/messages` on the co-op gateway pass `tools` / `tool_use` / `tool_result` through, and does `message_delta.usage` arrive? (#952)
- Which fiscal host, and is contributions-for-access acceptable to it? (#957)
- Are OC webhook payloads signed? If yes, verify signatures in #953; if no, the hint-then-verify design stands. (#951)
- Does GA sharing become membership-gated (#939 option C)?
- When the proxy is on the co-op upstream, does the consent dialog need a new `aiConsent.version`? (Yes in #955 — copy names the co-op.)

## Human Asks

- **Nathan Schneider / Inference Cooperative:** organizational membership terms; CORS allowlist for `prose.solo.ist` (optional); `/v1/messages` + tools support; whether Metagov would host Prose.
- **Fiscal host:** contributions-for-access policy; treatment of quid-pro-quo benefits for receipts; fee; maintainer payouts.
- **Angel:** sign off the provisional $10 / $15 once the first ledger month exists; decide #939.

## Corrections to the Earlier Brief and to Existing Docs

- "Auth0 as the billing layer" — there is no Auth0; Better Auth since #601. The join key is already email.
- "SaaS billing to replace" — nothing was built; only an unwired seam is dropped.
- "`docs/adr/NNNN-…`" — the repo convention is `docs/architecture/adr-*.md` (this file follows `adr-feature-flags.md`).
- "Prose uses the co-op's API" (pooled on a member key) — not permitted by the co-op's terms and not economical at $15/member; hence the organizational-membership gate and the Anthropic fallback.
- "MAS client can sign in (reader-app pattern)" in `roadmap.md`, `web-platform.md`, and the handoff doc — retired; 3.1.3(b) would apply.
- `docs/architecture/llm-pipeline.md:74` documents the tool-call event as `{streamId,id,name,args}`; the real payload nests under `toolCall`, and the Tool Modes section lists retired modes. Incidental; fix separately.

## References

- Issues: [#598](https://github.com/solo-ist/prose/issues/598) · [#601](https://github.com/solo-ist/prose/issues/601) · [#602](https://github.com/solo-ist/prose/issues/602) · [#683](https://github.com/solo-ist/prose/issues/683) · [#766](https://github.com/solo-ist/prose/issues/766) · [#770](https://github.com/solo-ist/prose/issues/770) · [#771](https://github.com/solo-ist/prose/issues/771) · [#813](https://github.com/solo-ist/prose/issues/813) · [#848](https://github.com/solo-ist/prose/issues/848) · [#849](https://github.com/solo-ist/prose/issues/849) · [#939](https://github.com/solo-ist/prose/issues/939) · [#942](https://github.com/solo-ist/prose/issues/942) · [#945](https://github.com/solo-ist/prose/issues/945) · [#951](https://github.com/solo-ist/prose/issues/951)–[#957](https://github.com/solo-ist/prose/issues/957)
- Docs: [`operating-model.md`](https://github.com/solo-ist/prose/blob/web-foundations/docs/architecture/operating-model.md) · [`web-platform.md`](https://github.com/solo-ist/prose/blob/web-foundations/docs/architecture/web-platform.md) · [`adr-feature-flags.md`](adr-feature-flags.md) · [`../roadmap.md`](../roadmap.md) · [`../web/beta-runbook.md`](https://github.com/solo-ist/prose/blob/web-foundations/docs/web/beta-runbook.md)
- Inference Cooperative: https://inference.coop · https://opencollective.com/inference-cooperative · https://git.inference.coop/co-op/docs (`api-access.md`, `models.md`, `getting-started.md`, `privacy-policy.md`, `terms-of-service.md`, `infrastructure.md`) · https://git.inference.coop/code/member-portal · https://git.inference.coop/code/litellm
- Open Collective: https://graphql-docs-v2.opencollective.com · https://docs.opencollective.com/help/developers/personal-tokens · https://docs.opencollective.com/help/developers/oauth · https://docs.opencollective.com/help/collectives/collective-settings/integrations · https://documentation.opencollective.com/why-open-collective/pricing · https://docs.opencollective.com/help/collectives/funding-options · `opencollective/opencollective-api` (`server/constants/activities.ts`, `server/constants/order-status.ts`, `server/graphql/v2/query/collection/OrdersCollectionQuery.ts`, `server/graphql/v2/interface/Account.ts`)
- Fiscal hosts: https://docs.oscollective.org/welcome-and-introduction-to-osc/fees · https://docs.oscollective.org/interested-in-joining-osc/acceptance-criteria · https://docs.oscollective.org/interested-in-joining-osc/is-osc-right-for-me · https://metagov.pubpub.org/pub/7bj5ia5g/release/1 · https://opencollective.com/metagov
- Apple: https://developer.apple.com/app-store/review/guidelines/#payments (3.1.1, 3.1.1(a), 3.1.3, 3.1.3(a), 3.1.3(b))
