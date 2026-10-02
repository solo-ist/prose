# Web Prose Operating Model — The Public Utility Posture

**Status:** Direction locked (research 2026-08-27) · **Rev 2 (2026-09-29):** funding rail + inference source decided — see [`adr-hosted-tier-funding-and-inference.md`](https://github.com/solo-ist/prose/blob/main/docs/architecture/adr-hosted-tier-funding-and-inference.md) (PR to `main`) · **Owner:** Angel
**Resolves:** the roadmap's "co-op mechanics" open question · **Parent:** Track C ([#598](https://github.com/solo-ist/prose/issues/598))

> The roadmap declares the ethos: *"a co-op, not a profit center — at-cost, usage-based plus a small monthly shared-infra subsidy."* This doc supplies the mechanics. The core finding from studying prior art (SourceHut, social.coop, Resonate's post-mortem, Open Collective, and now Inference Cooperative): **you don't need a formal co-op entity to be anti-extractive** — you need published unit economics, a transparent pricing formula, and a written governance-evolution path. The entity comes later, if ever. **Rev 2 adds the rails:** the money moves through an **Open Collective** collective (its ledger is the pricing page) and hosted inference is bought from a **member-governed co-op** rather than a hyperscaler.

---

## 1. Lessons borrowed

- **Resonate.coop (wound down 2023):** multi-stakeholder co-op governance *before* product-market fit was fatal — overhead and diffusion of authority at a stage that needed speed. Governance complexity kills momentum at small scale.
- **social.coop:** co-op governance works when membership is real and the shared interest is concrete (one server, one bill).
- **SourceHut (the closest model):** solo maintainer, open source, at-cost pricing, radical public financial narrative. Principles worth adopting verbatim: never price anyone out; price slightly above bare cost to avoid frequent increases; grandfather existing users; consult the community before changes.
- **Open Collective:** a public ledger is a transparency *mechanism*, not an entity — a fiscal host supplies the legal wrapper, and tiers with minimum amounts plus an API make it a workable membership rail, not just a tip jar.
- **Inference Cooperative (inference.coop, 2026):** a Metagov-hosted Open Collective collective selling AI inference to its members at a sliding scale ($10–20/mo → a $15/mo token allowance), governed by the members, running in attestable enclaves, with its membership sync open-sourced (`member-portal`). Proof that the posture below works at scale-of-dozens — and the upstream Prose wants to buy from.

## 2. The posture

### 2.1 Pricing — at-cost with published unit economics

The formula is public from day one and updated with real invoice data:

```
monthly price ≈ (member's metered inference cost, at the co-op's organizational rate)
             + (fixed infra ÷ active members)     ← Render + Postgres ~$13/mo, R2 pennies, Resend
             + small buffer (variance absorption, never profit)
```

While the gateway still runs on the Anthropic operator key (the fallback until the co-op agreement exists), the first line is the metered Anthropic cost — the 2026-08-27 estimate (moderate ≈ $2–4/mo, heavy ≈ $8–12) still holds for that case. At Inference Cooperative list prices a moderate member is ≈ $3–4/mo and a heavy one (5M input / 1M output on GLM-5.3) ≈ $15/mo; the organizational rate is a [#957](https://github.com/solo-ist/prose/issues/957) ask.

**The tier minimum is the formula's output, not an input.** Provisionally **$10/mo minimum** (moderate member at launch scale, rounded slightly up per the SourceHut principle) and **$15/mo suggested** (heavy member), set on the Open Collective tier and recomputed quarterly against the ledger. Mirroring the co-op's own numbers is a coincidence of the math, not the rule. The metering substrate is the one Track C already planned: `llm_usage` (written by the gateway relay, [#954](https://github.com/solo-ist/prose/issues/954)) + entitlements with the `granted_by` seam (value `opencollective`, written by [#953](https://github.com/solo-ist/prose/issues/953)). Because hosted inference is **pooled**, the soft per-member monthly quota (80% warning, 429 + `Retry-After` at 100%) in [#848](https://github.com/solo-ist/prose/issues/848) is **load-bearing**, not an addendum — a pricing tier still degrades gracefully, never surprise-403s.

### 2.2 Transparency — the ledger *is* the Open Collective page

Every operating cost is filed as a public expense on the Prose collective: Render web service · Render Postgres · Resend · Cloudflare R2 · Prose's own Inference Cooperative organizational membership (aggregate only — never per-user). The collective page therefore doubles as the pricing page, with the formula above in the tier copy. A short monthly post (prose.solo.ist or the blog, [#849](https://github.com/solo-ist/prose/issues/849)) links the ledger and states: active members · per-member infra cost · whether the at-cost target was hit · whether the minimum moves next quarter. SourceHut-style, near-zero overhead — and now with an audit trail Prose doesn't operate.

### 2.3 Governance — evolution with published thresholds

Written down so they're commitments, not vibes:

| Stage | Trigger | Model |
|---|---|---|
| **Now** | — | **Solo benevolent operator.** Angel sets pricing and policy. Commitments: at-cost formula, public OC ledger, no data selling, open-source codebase (self-hosting = the permanent exit hatch), community input via GitHub issues. Contributors see every expense and every update on the collective page. |
| **Community input** | ~20–50 active paying members | Public proposal forum (GitHub Discussions or the collective's Updates/Conversations); operator retains final say but responds to every proposal publicly; pricing changes consulted before they land. |
| **Formal structure** | ~100+ members / substantial recurring revenue | *Evaluate* a formal co-op or a different fiscal arrangement. Not before — Resonate is the cautionary tale. |

Separately, Prose as an *organizational member* of Inference Cooperative gets whatever seat the co-op's charter gives organizations — that is their governance, not ours, and Prose members are not automatically co-op members.

### 2.4 Legal — a fiscal host, still no entity of our own

An at-cost membership run by a sole operator still needs no special entity of its own: the **fiscal host** holds the funds and the legal responsibility. Candidates, in order: **Metagov** (501(c)(3); already hosts Inference Cooperative; fee per agreement; its policy wants a Metagov Research Director to lead or sponsor the project — a Nathan Schneider conversation) and **Open Source Collective** (10% flat; 501(c)(6); MIT + org repo qualify; its guidance excludes "funds for services or business transactions that directly benefit an individual or customer," so contributions-for-access must be cleared with them first). An independent collective needs its own bank account and entity, which stays ruled out. Questions to put to the host — contributions with a member benefit, receipts/deductibility, maintainer payouts, fee — are enumerated in [#957](https://github.com/solo-ist/prose/issues/957). Agents don't give tax conclusions. Entity formation waits for the third governance stage, if it ever arrives.

### 2.5 Inference — pooled from a co-op, BYOK direct

- **Hosted tier:** the gateway relays to **Inference Cooperative** on a negotiated organizational membership; Prose meters per-member allowances (§2.1). The co-op's ordinary terms forbid sharing credentials or reselling access and size a membership at $15/mo of tokens per person, so **pooling requires their agreement** (governance ask, [#957](https://github.com/solo-ist/prose/issues/957); technical spike [#952](https://github.com/solo-ist/prose/issues/952)). **Until then the proxy keeps the Anthropic operator key exactly as today** — nothing in Web W1 or desktop GA waits on this.
- **Web mode** always goes through Prose's gateway: the co-op gateway refuses browser CORS for `prose.solo.ist` (verified 2026-09-29), and the gateway is the single metering point anyway.
- **BYOK stays direct** and is never metered: a user's own co-op key on desktop is the first [#683](https://github.com/solo-ist/prose/issues/683) slice ([#956](https://github.com/solo-ist/prose/issues/956)); Anthropic BYOK is unchanged.
- **Agentic editing** (the `suggest_edit` tool loop) stays on Anthropic until #952 shows a co-op model drives it reliably.
- **Privacy:** the co-op runs inference in Tinfoil TEE enclaves (attestable), doesn't train on data, and logs metering metadata (tokens, model, timestamps) — the same class of metadata Prose's own `llm_usage` keeps. `docs/privacy.md` is rewritten for hosting in [#940](https://github.com/solo-ist/prose/issues/940).

## 3. What Track C already provides vs. what this adds

**Already in the phases:** entitlements + `granted_by` seam + `expiresAt` (Phase 0, live) · the gated relay (`/api/llm/stream`, live on the Anthropic key) · a self-hostable gateway monolith (the sovereignty path) · abstract storage seam · per-user metering planned (#766 `llm_usage`).

**Work this doc adds (filed 2026-08-27 and 2026-09-29):**
1. **Pricing methodology + transparency** — [#849](https://github.com/solo-ist/prose/issues/849): formula copy + the monthly post; the OC page is the ledger.
2. **Soft monthly token quota** — [#848](https://github.com/solo-ist/prose/issues/848): now load-bearing.
3. **Open Collective as the payment rail** — spike [#951](https://github.com/solo-ist/prose/issues/951) → build [#953](https://github.com/solo-ist/prose/issues/953) (webhook hint → GraphQL verify → reconcile cron; grace via `expiresAt`; `GET /api/account/entitlements`; revoke CLI). Replaces the Stripe skeleton in [#770](https://github.com/solo-ist/prose/issues/770).
4. **Inference Cooperative as the hosted upstream** — spike [#952](https://github.com/solo-ist/prose/issues/952) → swap [#954](https://github.com/solo-ist/prose/issues/954) (config, tools + system-cap fixes in the relay, `llm_usage` write).
5. **Hosted-features gating + membership UI** — [#955](https://github.com/solo-ist/prose/issues/955) (`hostedInference` flag, `account:*` IPC, Settings Account section, lapsed states; MAS keeps zero hosted surface — the "reader-app" framing is retired, see the ADR).
6. **Desktop BYOK co-op key** — [#956](https://github.com/solo-ist/prose/issues/956).
7. **Human prerequisites** — [#957](https://github.com/solo-ist/prose/issues/957): the collective, the fiscal host, the co-op ask.

## 4. Boundaries

- No co-op entity, member shares, or multi-stakeholder governance before ~50 active paying members. The fiscal host is the entity.
- No real-time cost dashboard (the Open Collective page + a monthly post is the right overhead for a personal-scale service).
- No payment collection before [#953](https://github.com/solo-ist/prose/issues/953); manual/beta grants only until then.
- No pooled co-op inference before the co-op agrees; the Anthropic operator key is the shipped state until [#954](https://github.com/solo-ist/prose/issues/954).
- Quota columns land with #953/#848, not before — the Phase 0/1 schema stays minimal until then.
- Per-user inference numbers are never published; aggregates only.
- No hosted surface, sign-in, or membership link in the Mac App Store build, ever (App Store guideline 3.1.3(b) would otherwise require IAP parity).

## 5. Sources

- SourceHut pricing philosophy: https://sourcehut.org/blog/2025-12-01-proposed-pricing-changes/
- Resonate post-mortem discussion: https://community.coops.tech/t/learning-from-resonate-co-op/3742
- social.coop governance: https://wiki.social.coop/index.php?title=Governance
- Open Collective / OFi pricing + governance transition: https://pricing-2026.opencollective.com/ · https://documentation.opencollective.com/why-open-collective/pricing
- Open Collective API: https://graphql-docs-v2.opencollective.com · https://docs.opencollective.com/help/developers/personal-tokens · https://docs.opencollective.com/help/collectives/collective-settings/integrations
- Inference Cooperative: https://inference.coop · https://opencollective.com/inference-cooperative · https://git.inference.coop/co-op/docs · https://git.inference.coop/code/member-portal
- Fiscal hosts: https://docs.oscollective.org/welcome-and-introduction-to-osc/fees · https://docs.oscollective.org/interested-in-joining-osc/is-osc-right-for-me · https://metagov.pubpub.org/pub/7bj5ia5g/release/1
- Apple App Store Review Guidelines §3.1: https://developer.apple.com/app-store/review/guidelines/#payments
