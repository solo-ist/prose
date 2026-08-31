# Web Prose Operating Model — The Public Utility Posture

**Status:** Direction locked (research 2026-08-27) · **Owner:** Angel
**Resolves:** the roadmap's "co-op mechanics" open question · **Parent:** Track C ([#598](https://github.com/solo-ist/prose/issues/598))

> The roadmap declares the ethos: *"a co-op, not a profit center — at-cost, usage-based plus a small monthly shared-infra subsidy."* This doc supplies the mechanics. The core finding from studying prior art (SourceHut, social.coop, Resonate's post-mortem, Open Collective): **you don't need a formal co-op entity to be anti-extractive** — you need published unit economics, a transparent pricing formula, and a written governance-evolution path. The entity comes later, if ever.

---

## 1. Lessons borrowed

- **Resonate.coop (wound down 2023):** multi-stakeholder co-op governance *before* product-market fit was fatal — overhead and diffusion of authority at a stage that needed speed. Governance complexity kills momentum at small scale.
- **social.coop:** co-op governance works when membership is real and the shared interest is concrete (one server, one bill).
- **SourceHut (the closest model):** solo maintainer, open source, at-cost pricing, radical public financial narrative. Principles worth adopting verbatim: never price anyone out; price slightly above bare cost to avoid frequent increases; grandfather existing users; consult the community before changes.
- **Open Collective:** a public ledger is a transparency *mechanism*, not an entity — usable (free tier) without fiscal hosting.

## 2. The posture

### 2.1 Pricing — at-cost with published unit economics

The formula is public from day one and updated with real invoice data:

```
monthly price ≈ (user's metered Anthropic cost)
             + (fixed infra ÷ active users)     ← Render ~$13/mo + R2 pennies
             + small buffer (variance absorption, never profit)
```

Launch estimate: moderate AI use ≈ $2–4/mo of Anthropic cost, heavy ≈ $8–12 → **target ~$8–12/mo**, revised quarterly against actuals. The metering already planned in Track C is the substrate: `llm_usage` (write-only meter, #766) + entitlements with the `granted_by` seam (#770). A soft per-user monthly token quota (80% warning, hard stop at 100% with `Retry-After`) belongs to #770 — a pricing tier should degrade gracefully, not surprise-403.

### 2.2 Transparency — the monthly cost ledger post

A short monthly post (on prose.solo.ist or the blog): Render invoice · R2 invoice · Anthropic invoice (aggregate only — never per-user) · active paid users · per-user infra cost · whether the at-cost target was hit. SourceHut-style, near-zero overhead, and it is what makes "anti-extractive" credible rather than rhetorical — even at scale-of-one. Optionally mirrored to a free-tier Open Collective ledger for a structured audit trail.

### 2.3 Governance — evolution with published thresholds

Written down so they're commitments, not vibes:

| Stage | Trigger | Model |
|---|---|---|
| **Now** | — | **Solo benevolent operator.** Angel sets pricing and policy. Commitments: at-cost formula, monthly ledger, no data selling, open-source codebase (self-hosting = the permanent exit hatch), community input via GitHub issues. |
| **Community input** | ~20–50 active paying members | Public proposal forum (GitHub Discussions); operator retains final say but responds to every proposal publicly; pricing changes consulted before they land. |
| **Formal structure** | ~100+ members / substantial recurring revenue | *Evaluate* a formal co-op or fiscal host. Not before — Resonate is the cautionary tale. |

### 2.4 Legal — nothing, deliberately

An at-cost subscription run by a sole operator needs no special entity. Anti-extraction is a design commitment and a public promise, not a legal category. Entity formation waits for the third governance stage, if it ever arrives.

## 3. What Track C already provides vs. what this adds

**Already in the phases:** per-user metering (#766 `llm_usage`) · entitlements + `granted_by` + unwired Stripe skeleton (#770) · a self-hostable gateway monolith (the sovereignty path) · abstract storage seam.

**New work this doc adds (filed as issues):**
1. **Pricing methodology + cost transparency page** — the public formula + the first monthly ledger post, landing with the gateway launch. Docs/design work, parallel to #770, not a gate.
2. **#770 addendum — soft monthly token quota** on entitlements (80% warn / 429 + `Retry-After` at cap) and the `llm_usage` read path for billing math.

## 4. Boundaries

- No co-op entity, member shares, or multi-stakeholder governance before ~50 active paying members.
- No real-time cost dashboard (a monthly post is the right overhead for a personal-scale service).
- No payment collection before #770; manual/beta grants only.
- No quota columns before Phase 4 — the Phase 0/1 schema stays minimal.

## 5. Sources

- SourceHut pricing philosophy: https://sourcehut.org/blog/2025-12-01-proposed-pricing-changes/
- Resonate post-mortem discussion: https://community.coops.tech/t/learning-from-resonate-co-op/3742
- social.coop governance: https://wiki.social.coop/index.php?title=Governance
- Open Collective / OFi pricing + governance transition: https://pricing-2026.opencollective.com/
