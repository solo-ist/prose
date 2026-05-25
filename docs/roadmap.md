# Prose Roadmap

**Status:** Active · **Updated:** 2026-05-25

This is the overarching roadmap for Prose's next several epics. It is **release-agnostic**: waves are the unit of work, and a real version number is assigned to a wave only when it's cut. The [GitHub project board](https://github.com/orgs/solo-ist/projects/5/views/1) tracks live priority; this doc is the narrative — the distribution model, the epics, and the wave sequencing. Milestones on the board mirror the waves below.

## Blockers & Open Questions

**Blockers / prerequisites:**
- **#120 Google OAuth prod verification** — gates *Google Docs sync shipping publicly only*. It is **not** a blocker for the identity spike (#601) or Track C generally.
- **Spike #601 (identity/accounts) + #602 (billing/metering)** — together gate the Track C build start.
- *(Resolved: auto-update delivery, #577 — shipped. Release delivery to existing users is no longer blocked.)*

**Open questions (intentionally unresolved):**
- **Wave-1 headline** — which track leads the story: the Smarter Desktop App (most novel) or reMarkable parity (most immediately useful)?
- **Paid wedge** — market the paid tier as "Prose anywhere" (web + gateway) or "Prose for reMarkable power users"? Hard to headline both.
- **Co-op mechanics** — what an at-cost / usage-based / co-op model concretely looks like (governance, transparency, how the shared-infra subsidy is set). Parked research; *not* a Track C gate.
- **Generative terminal security model** — how to run a coding agent in a terminal tab without breaking the locked-down posture (Wave 2 discovery).

## Distribution & Monetization Model

A foundational decision that reshapes the rest of this plan:

**The Mac App Store build is a free taste, not the paid surface.** MAS is a local client that exists for distribution, trust, and discovery — it never carries the subscription and never hosts the generative roadmap (the sandbox structurally excludes the terminal/codebase work). From that free taste, users fork two ways: toward *managed convenience* (signing into the paid web services) or *sovereignty* (grabbing the self-distributed OSS build and hacking it).

**Paid lives exclusively on the self-distributed / web direct model.** No StoreKit IAP. We sell the subscription on the web (billing + entitlements), and any client — the self-distributed desktop build or the web app — signs into that account to consume it. A free MAS client can still *sign in* to use an externally-purchased subscription (Apple's reader-app pattern), with the single constraint that the MAS build can't link to or advertise the external purchase (anti-steering). The earlier Apple-IAP problem dissolves because we simply don't sell through Apple. (The at-cost reasoning still holds — Apple's Small Business tier is 15%, not 30% — but usage-based metering fits IAP badly regardless, which is another reason to keep it off-store.)

**One unified open-source codebase, two build targets.** We stay unified and gate features by build target, exactly as reMarkable and MAS-specific behavior are already gated today (`IS_MAS_BUILD`, feature flags; see `architecture/adr-feature-flags.md`). The generative/terminal work compiles out of the MAS build the way reMarkable already does. A separate MAS code fork is explicitly deferred — a permanent maintenance tax we take on only if a divergence becomes provably load-bearing, not in anticipation.

**The subscription is an indivisible foundation.** Gateway + accounts + metering land *together* before we can charge anything — so that bundle, not any single feature, is the long pole and where all schedule risk lives. Everything that sits on top (web editor, managed transcription) is comparatively cheap once the foundation exists.

## Sequencing

### Spikes — Discovery & De-risking
Cheap but calendar-bound, since they gate the expensive work. Start now, in parallel.
- **#601 — Identity / accounts / entitlements** (Auth0 baseline; evaluate Clerk / WorkOS / Supabase against it). **Leads #602 by a short head.**
- **#602 — Billing + usage-metering + pricing-shape decision** (co-op / usage / flat / hybrid; Stripe Billing / Lago / OpenMeter). Informed by #601's leaning; both consider bundled identity+billing options.
- **#603 — Unified-vs-fork** (light confirmation; expect "yes" — terminal is MAS-excluded by construction).

### Wave 0 — QoL & Bug Fixes
Immediate, shippable independent of the epics. ~6 PRs:
- **P1 data-loss / broken-core:** #578, #595. *(#577 auto-update and #584 chat-input already shipped.)*
- **P2 statusbar/editor:** #563, #564, #562 · **P3 UI polish:** #561, #565, #539 · **P4 file-watcher:** #517, #518 · **P5 editor/tool correctness:** #516, #571, #572.
- **MAS Refresh mini-track** (parallel, not a blocker): audit of the parked MAS items (#391, #409, #376, #317, #487) + App Store asset refresh (#612 visuals, #613 text) to match the new branding.

### Wave 1 — Core Build-Out (three concurrent tracks)
Each track branches from main and runs concurrently:
- **Track A — A Smarter Desktop App (#596)** — agent control of panels, File Explorer, allowlisted settings.
- **Track B — reMarkable App Parity (#597)** — cover images, notebook view, EPUB/PDF, two-way text sync.
- **Track C — Paid Platform Foundation (#598)** — gateway + accounts + metering. **Build gated on #601 + #602.**

**Merge ladder + release-cut (default).** HITL QA gate at **each merge boundary** in the **A → B → C** ladder: a track completes → pause for human QA → on approval, decide **cut a release tag** vs. **roll forward** to the next track. The first shippable increment is Track A's merge. Versions are assigned at the moment of cut. This is a default that can be overridden at any gate — the tag decision lives at the QA gate, not in any issue or commit. A **file-overlap pre-check** runs before any parallel dispatch (Track A touches the agent surface / panels / settings; Track B touches `src/main/remarkable/`; Track C is new account/gateway plumbing — overlap is a signal to reconcile sequencing).

### Wave 2 — Generative Deep End
OSS-only (the terminal is MAS-excluded by construction).
- **Generative Codebase (#599)** — Phase 1 terminal tabs (#233) → Phase 2 sandboxed Claude Code CLI (checkout repo, make changes, submit a PR *or* file an issue/bug) → Phase 3 *deferred* (user-side build/distribution; fork-rebuild or hosted build).
- **Co-resident: #439** — hosted-OCR upsell, a deferred child of Paid Platform Foundation (depends on Track C being *live*, not just built).

## Epics

| Epic | Track / Wave | Milestone | Children / seeds |
|------|--------------|-----------|------------------|
| [#596] A Smarter Desktop App | Track A / Wave 1 | Wave 1 — Core Build-Out | #604, #605, #606, #607; #314, #533, #556, #260 |
| [#597] reMarkable App Parity | Track B / Wave 1 | Wave 1 — Core Build-Out | #608, #609, #610, #611; #403, #466 |
| [#598] Paid Platform Foundation | Track C / Wave 1 | Wave 1 — Core Build-Out | #258, #364; gated on #601/#602; deferred child #439 |
| [#599] Generative Codebase | Wave 2 | Wave 2 — Generative Deep End | #233 (prereq), #219 |
| [#600] Authorship Annotations | placeholder | *(none)* | #525, #537, #570 |

Spikes #601 / #602 / #603 sit under the *Spikes — Discovery & De-risking* milestone.

## Universal Enhancements

These are universal across both paid and OSS builds.

### reMarkable App Parity
Achieve full feature parity with the reMarkable desktop app, exceeded by the Prose value-add: cover-image visualization, notebook view, EPUB/PDF upload, two-way typed-doc sync. These are local client features hitting the reMarkable cloud API (`src/main/remarkable/`) — buildable today, no backend.

The one feature that needs the cloud/billing layer is **better transcription**: OCR already exists in Prose but local quality is poor. The managed, higher-quality cloud OCR is the clean **paid upsell** (#439, Wave 2) — *improving* existing transcription, not introducing it. We carve the "needs backend + billing" work out from "just more reMarkable client work" so the OSS client gets richer (drives adoption) while managed transcription rides on the Paid Platform.

### Generative Features

**A Smarter Desktop App.** Give the built-in agent real control of the app by broadening the tool-call affordances that hook into app behavior — the same pattern as the MCP tool surface (schema in `src/shared/tools/`, mode-gate, wire IPC, execute in renderer; builds on the merged list_tabs/select_tab #450 and persona epic #467). Affordances: adaptive window/panel sizing, File Explorer interaction, allowlisted settings toggles, command palette (#260). The only real hazard is sensitive/destructive operations — write access to settings holding API keys or sandbox-adjacent flags — so the agent gets a curated **allowlist** and the features build on the existing modes (Chat / Editor / Create). The hard part isn't the plumbing, it's the **control model**: when may it act, can you lock/undo it, does it ask first? Generative UI is a great demo and an infuriating default, so UX is paramount.

**Generative Codebase.** "Personal software" writ large — software that adapts to the user's intent and, eventually, its own source. A new terminal-session tab opens three phases:
1. **Terminal tabs** — the prerequisite (#233).
2. **Sandboxed Claude Code CLI** that can check out the repo, make changes on the user's behalf, and submit a PR *or* file a GitHub issue / bug report (low risk — basically what `gh` + the cloud pipeline already do).
3. **Deferred:** user-side build & distribution (fork-and-rebuild or a hosted build service). Not required for Wave 2.

This fights the locked-down security model (`sandbox: true`, `contextIsolation: true`, path-validated IPC), so it's **MAS-excluded by construction** and ships OSS-only — gated out of the MAS build the way reMarkable already is. The future Prose CLI / CMS (#219) eventually lives here too.

## Subscription Services

### LLM Gateway
The keystone, sequenced first within Track C. A hosted LLM provider powers a paid inference tier — for the future web mode and as a convenience for users who don't want to manage their own key. Per the distribution decision, this never routes through MAS: the self-distributed desktop build stays BYOK by default but can accept a subscription key, and the web app authenticates against the same account. The gateway is also what lifts web mode past the Anthropic CORS wall, so the **web editor rides directly on it**. This is where the usage-metering surface, subscription support, and account creation live.

### Accounts and Auth
Today we only have Google OAuth for Google's Docs-sync APIs — that's not accounts, entitlements, or a subscription system. A paid tier needs account records, in-app entitlement checks, and tax handling. Google OAuth can be the identity *anchor*, but it isn't a stand-in for billing. (#120 — Google OAuth prod verification — is a hard prerequisite for anything Google-auth-gated shipping publicly.) Spike #601 evaluates the stack, with Auth0 as the known-good baseline.

### Subscriptions
The old open question — MAS + Apple IAP — is resolved by the Distribution & Monetization Model above: we don't sell through MAS, so StoreKit IAP is off the table and the Apple-commission / usage-based-metering mismatch never bites. #439 has been **reframed** accordingly (hosted OCR as a web-gated entitlement, Wave 2).

The wedge is two-fold and really an extension of taking the app to the full feature set I want for myself: **"Prose anywhere"** (web + gateway) and **"Prose for reMarkable power users."** On payment models, the goal is a **co-op**, not a profit center — the subscription is a convenience layer surfacing LLM capabilities, likely usage-based plus a super-cheap monthly shared subsidy for common infrastructure and operating costs.
