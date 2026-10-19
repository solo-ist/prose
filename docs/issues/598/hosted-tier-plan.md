# Hosted-Tier Batch Plan — Open Collective + Inference Cooperative

**Epic:** [#598](https://github.com/solo-ist/prose/issues/598) Prose Web · **Decided:** 2026-10-19 · **Owner:** Angel
**Decision record:** [`../../architecture/adr-hosted-tier-funding-and-inference.md`](../../architecture/adr-hosted-tier-funding-and-inference.md) (Amendments, 2026-10-19) · **Mechanics:** [`../../architecture/operating-model.md`](../../architecture/operating-model.md)

> The ADR decided *what*: an Open Collective recurring contribution funds the hosted tier, Inference Cooperative is the pooled upstream, the Anthropic operator key is the fallback, MAS keeps zero hosted surface. This document decides *in what order*, so the batch never idles on a human step. The project board is the live queue; this is the resumable narrative.

## What changed since the ADR (verified 2026-10-19)

| Fact | ADR (2026-09-29) | Now |
|---|---|---|
| Inference Cooperative dues | $10–20/mo sliding scale, $10 floor | **from $5/mo**, "many members pay $15"; same $15/mo allowance |
| Co-op size | 26 contributors, ~$3.9k/yr | 45 contributors, ~$6.4k/yr |
| Organizational membership | not offered | still not mentioned publicly — remains a conversation |
| Fiscal host guidance | Metagov first, OSC second | **ask both in parallel**; neither publishes a membership-with-benefit policy |

Implications: Angel is already an individual member, so the #952 spike can start today; the co-op subsidizes members heavily, so the organizational rate will likely sit well above the member rate; the fiscal-host answer is the single longest pole and nothing downstream of it should wait serially.

The values-aligned-hosting research (2026-10-17) that prompted this also recommended moving the personal and marketing static sites to May First. That is outside this roadmap; the gateway stays on Render, and Render stays a public expense on the ledger wherever the static sites live.

## Three lanes, two gates

Nothing in the gateway depends on a human step until the Open Collective sync and the upstream flip. So the batch splits into lanes that run concurrently.

### Lane H — human (Angel) · [#957](https://github.com/solo-ist/prose/issues/957)

1. Put the membership-with-benefit question to **Open Source Collective** and **Metagov** at the same time (wording on #957).
2. Pick the host; create the collective; set the two tiers; mint the personal token into Render env.
3. Raise the organizational / app-partner ask with the co-op.

### Lane S — spikes (agent)

| Spike | Can start | Waits on |
|---|---|---|
| [#951](https://github.com/solo-ist/prose/issues/951) Open Collective → entitlement check | now, against a scratch collective (admin-only GraphQL works before a host approves; webhook capture needs the test endpoint) | — |
| [#952](https://github.com/solo-ist/prose/issues/952) (a) `/v1/messages` passthrough, (b) tool loop on 2–3 co-op models, (d) usage shape | now, on Angel's existing member key | — |
| [#952](https://github.com/solo-ist/prose/issues/952) (c) organizational terms | — | Lane H step 3 |

### Lane B — ungated build (agent), in order

1. [#1059](https://github.com/solo-ist/prose/issues/1059) Settings → Account sign-in state. Lifts the auth state machine out of `ShareDialog` into a shared store; the membership layer builds on that store. Rides the 1.9.0 train.
2. [#1074](https://github.com/solo-ist/prose/issues/1074) `GET /api/account/entitlements` + revoke CLI + session revocation. Fixes the response shape #955 builds against; `membership` is filled in later by #953.
3. [#1075](https://github.com/solo-ist/prose/issues/1075) relay generalization on the Anthropic key: tools through the proxy, system cap, configurable model list, `LLM_UPSTREAM_*` config, `llm_usage` write-only meter. Also unblocks real chat through today's proxy (#766's noted blocker).
4. [#848](https://github.com/solo-ist/prose/issues/848) soft monthly quota on a static per-grant `monthlyTokenLimit` (nullable = unlimited), reading `llm_usage` from step 3. Memberships refine the limit later.
5. [#955](https://github.com/solo-ist/prose/issues/955) hosted gating + membership UI: `hostedInference` flag, `account:*` IPC, entitlement status + `graceUntil`, lapsed states, consent copy. The "Manage membership" link reads one constant that stays empty until Lane H step 2.

Gateway changes deploy to Render independently of app releases. App-side pieces (#1059, #955) ride release trains; #1059 is on 1.9.0, #955 targets the release after.

### Gated builds

| Build | Gate |
|---|---|
| [#953](https://github.com/solo-ist/prose/issues/953) Open Collective sync (webhook hint → GraphQL verify → reconcile cron → `Membership` → `membership` on the endpoint) | #951 done · collective + token exist |
| [#954](https://github.com/solo-ist/prose/issues/954) upstream flip to the co-op (config values + model list; OpenAI translation only if #952 says passthrough fails) | #952 (a)(b)(c) go · organizational agreement |
| [#849](https://github.com/solo-ist/prose/issues/849) pricing-formula copy + first monthly ledger post | collective exists |
| [#956](https://github.com/solo-ist/prose/issues/956) desktop BYOK co-op key | #952 (a)(b); Later |

Alongside, not part of this batch: [#766](https://github.com/solo-ist/prose/issues/766) web client wiring and [#767](https://github.com/solo-ist/prose/issues/767) server-side storage are the *web version* half of the epic and proceed on their own schedule.

## Hygiene applied 2026-10-19

- #953 / #954 narrowed to their gated halves; #1074 / #1075 filed as native sub-issues of #598 and placed in **Do First**.
- #770 closed as superseded (its last item, `sessions` revocation, moved to #1074) and archived off the board.
- #853 (closed) archived off the board.
- #957 checklist updated: ask both hosts in parallel; OSC's exact exclusion wording; individual co-op membership already held (ticked).
- ADR + operating model carry dated amendments rather than silent rewrites.

## Open until Lane H answers

- Which fiscal host, and is a contribution tier that grants hosted access acceptable to it.
- Whether the co-op will sell an organizational allowance, at what rate, and whether LiteLLM teams can scope a Prose key.
- Whether `/v1/messages` on the co-op gateway passes `tools` / `tool_use` / `tool_result` (decides #954's size).
- [#939](https://github.com/solo-ist/prose/issues/939): whether `share_publish` becomes membership-gated at Share GA.
