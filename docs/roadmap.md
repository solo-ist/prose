# Prose Roadmap

**Status:** Active · **Updated:** 2026-06-01 · **Live priority:** [Project board #5](https://github.com/orgs/solo-ist/projects/5/views/1)

> **Reading this cold?** Top-to-bottom this tells you the strategy, the phase we're in, what to pick up next, and how work flows — enough to resume mid-stream. This doc is the narrative + operating model; the **project board is the live queue** and the **milestones mirror the waves**. For dev/security/build conventions, see [`../CLAUDE.md`](../CLAUDE.md).

---

## You are here

- **Active wave: Wave 0.5 — MAS Refresh** (8 issues, *Do Next*). The next App Store release — bundles Wave 0's shipped QoL/feature work with the rebrand ([#612](https://github.com/solo-ist/prose/issues/612)/[#613](https://github.com/solo-ist/prose/issues/613)), drop-to-free pricing ([#615](https://github.com/solo-ist/prose/issues/615)), and MAS hardening ([#391](https://github.com/solo-ist/prose/issues/391) Sentry CSP, [#376](https://github.com/solo-ist/prose/issues/376) asar fuses).
- **Grab-next / critical path:** [#487](https://github.com/solo-ist/prose/issues/487) — `masDev` local launch fails (Launchd 163). Local MAS-sandbox QA is broken, so verification currently falls back to the slow TestFlight upload cycle. **Being debugged first** to restore a tight local loop before the rest of the refresh.
- **The cheap bulk:** [#615](https://github.com/solo-ist/prose/issues/615) (free pricing — config), [#612](https://github.com/solo-ist/prose/issues/612) (screenshots + icon), [#613](https://github.com/solo-ist/prose/issues/613) (App Store description + persona copy — the current copy in [`app-store-copy.md`](app-store-copy.md) is stale). [#409](https://github.com/solo-ist/prose/issues/409) (universal binary) and [#317](https://github.com/solo-ist/prose/issues/317) (agent-driven macOS UI testing) are deprioritized.
- **Hard boundary:** never submit for App Store review — TestFlight upload is the automation edge; submission is a human action. MAS `buildVersion` is global-monotonic — never reset it on a marketing-version bump.
- **Wave 0 — done.** Shipped in **v1.5.0** (2026-05-28 — P1–P5 bug/QoL batch + [#641](https://github.com/solo-ist/prose/issues/641) HTML export) and **v1.6.0** (2026-06-01 — [#385](https://github.com/solo-ist/prose/issues/385) Quick Review redesign · [#386](https://github.com/solo-ist/prose/issues/386) AI edits history · [#380](https://github.com/solo-ist/prose/issues/380) Projects & Favorites first pass). **v1.6.1** (2026-06-02) is now the latest published GitHub release (DMG/ZIP, notarized), adding a follow-up batch — #645 annotation visibility, #646 reopen-closed-tab, #648 comment anchoring, plus reMarkable fixes #652/#667. MAS is still deferred to this Wave 0.5 run. Stragglers still open: [#384](https://github.com/solo-ist/prose/issues/384) Homebrew Cask (now unblocked by the notarized DMG) and [#536](https://github.com/solo-ist/prose/issues/536) Sentry→GitHub (hybrid: agent repo slice + manual Sentry-console slice). [#380](https://github.com/solo-ist/prose/issues/380) stays open pending follow-up [#654](https://github.com/solo-ist/prose/issues/654).
- **Next:** **Wave 1 — Core Build-Out** — three concurrent tracks on the **A→B→C merge ladder**, gated by the spikes ([#601](https://github.com/solo-ist/prose/issues/601)/[#602](https://github.com/solo-ist/prose/issues/602) for Track C, [#616](https://github.com/solo-ist/prose/issues/616) for Track B).
- **Deferred (On Hold):** Wave 2 (Generative Codebase), vision/research, and the parked Authorship Annotations cluster.

## How work flows (operating model)

- **Column = phase, milestone = wave:**
  | Column | Phase |
  |---|---|
  | **Do First** + **Quick Wins** | Wave 0 (Do First = priority/bigger; Quick Wins = small) |
  | **Do Next** | Wave 0.5 — MAS Refresh |
  | **Later** | Wave 1 + its spikes + parked-but-tracked (Annotations) |
  | **On Hold** | deferred: Wave 2, vision/research, launch gates |
- **Cadence:** each wave is sequenced cloud-agent work → local HITL QA. One issue per PR, reference the issue, and **wait for green CI + the `claude[bot]` review before merging** (no skipping the wait).
- **Wave 1 merge ladder (load-bearing):** Tracks A, B, C run concurrently but merge **A → B → C** — each lands as the stable base the next rebases onto. There's a HITL QA gate at every boundary; at each gate, decide **cut a release tag** vs. **roll forward**. Versions are assigned at the moment of cut (the roadmap is release-agnostic — waves are the unit). Run a **file-overlap pre-check** before any parallel dispatch (A = agent surface/panels/settings; B = `src/main/remarkable/`; C = account/gateway plumbing).
- **Spikes gate Track C:** [#601](https://github.com/solo-ist/prose/issues/601) + [#602](https://github.com/solo-ist/prose/issues/602) must conclude before the Paid Platform build starts; [#603](https://github.com/solo-ist/prose/issues/603) is a light confirmation; [#616](https://github.com/solo-ist/prose/issues/616) validates Track B's scope before building it.
- **Board hygiene (hard rules):**
  - **Never** mutate board field definitions — it silently wipes every item's status. Only move items between existing columns (`gh project item-edit`).
  - **Archive** closed items (`gh project item-archive`), don't delete and don't leave them in an active column.
  - **Never** add the `accelerated` label to a new issue — it auto-dispatches cloud agents. Apply only after a human gate.
  - Use `gh` for all GitHub ops (issues, PRs, board, labels, milestones).

## Distribution & Monetization Model

A foundational decision that shapes everything below:

**The Mac App Store build is a free taste, not the paid surface.** MAS is a local client for distribution, trust, and discovery — it never carries the subscription and never hosts the generative roadmap (the sandbox structurally excludes the terminal/codebase work). From the free taste, users fork two ways: *managed convenience* (sign into the paid web services) or *sovereignty* (grab the self-distributed OSS build and hack it).

**Paid lives exclusively on the self-distributed / web direct model.** No StoreKit IAP. We sell the subscription on the web (billing + entitlements); any client — self-distributed desktop or web — signs into that account to consume it. A free MAS client can still *sign in* to use an externally-purchased subscription (Apple's reader-app pattern), with the one constraint that the MAS build can't link to or advertise the external purchase (anti-steering). The Apple-IAP problem dissolves because we don't sell through Apple. (At-cost reasoning still holds — Apple's Small Business tier is 15% — but usage-based metering fits IAP badly regardless.)

**One unified open-source codebase, two build targets.** We stay unified and gate features by build target, exactly as reMarkable and MAS-specific behavior are gated today (`IS_MAS_BUILD`, feature flags; see [`architecture/adr-feature-flags.md`](architecture/adr-feature-flags.md)). The generative/terminal work compiles out of MAS the way reMarkable already does. A separate MAS code fork is deferred — a maintenance tax we take on only if a divergence becomes provably load-bearing.

**The subscription is an indivisible foundation.** Gateway + accounts + metering land *together* before we can charge anything — that bundle is the long pole and where all schedule risk lives. Everything on top (web editor, managed transcription) is comparatively cheap once it exists.

**Payment philosophy:** a **co-op**, not a profit center — at-cost, likely usage-based plus a small monthly shared-infra subsidy. The subscription is a convenience layer over LLM access.

---

## Phases & sequencing

The phases run roughly in order: **Wave 0 → Wave 0.5 → (Spikes) → Wave 1 → Wave 2.** Wave 0 and 0.5 ship the next releases; the Spikes de-risk and gate the Wave 1 push; Wave 2 is the deferred deep end.

### Spikes — Discovery & De-risking · *Later column · gate the Wave 1 push*
| Issue | Captures |
|---|---|
| [#601](https://github.com/solo-ist/prose/issues/601) | Pick the **identity/accounts/entitlements** stack (Auth0 baseline). Leads #602; gates Track C. |
| [#602](https://github.com/solo-ist/prose/issues/602) | Pick the **billing + metering** stack and decide the **pricing shape** (co-op/usage/flat/hybrid). Gates Track C with #601. |
| [#603](https://github.com/solo-ist/prose/issues/603) | Light confirmation that generative/terminal gates cleanly out of MAS. Expect "yes." |
| [#616](https://github.com/solo-ist/prose/issues/616) | Research the official reMarkable app + competitive landscape to validate Track B's parity scope before building it. |

### Wave 0 — QoL & Bug Fixes · *done — shipped v1.5.0 + v1.6.0 + v1.6.1*
Shipped as sequenced cloud-agent batches + local QA. The P1–P5 bug/QoL batch landed in v1.5.0; the three features (#385/#386/#380) in v1.6.0; a follow-up batch (#645/#646/#648/#652/#667) in v1.6.1. Stragglers still open: #384 (Homebrew) and #536 (Sentry→GitHub hybrid); #380 held for follow-up #654.

| Issue | Group | Captures |
|---|---|---|
| [#578](https://github.com/solo-ist/prose/issues/578) | P1 data-loss | Stop `suggest_edit` clobbering the whole doc on a single-paragraph node. |
| [#595](https://github.com/solo-ist/prose/issues/595) | P1 data-loss | Persist comment marks across tab switch / editor reset. |
| [#563](https://github.com/solo-ist/prose/issues/563) | P2 statusbar | Live word/char count. |
| [#564](https://github.com/solo-ist/prose/issues/564) | P2 statusbar | Fix cursor stuck at Ln 1, Col 1. |
| [#562](https://github.com/solo-ist/prose/issues/562) | P2 editor | Comment tooltip clipped by the nav bar. |
| [#561](https://github.com/solo-ist/prose/issues/561) | P3 polish | Hide AI model selector when AI disabled. |
| [#539](https://github.com/solo-ist/prose/issues/539) | P3 polish | Tone down over-bright selection highlight (dark/mono). |
| [#516](https://github.com/solo-ist/prose/issues/516) | P5 correctness | Tighten `suggest_edit` frontmatter fall-through. |
| [#571](https://github.com/solo-ist/prose/issues/571) | P5 correctness | `insert(after_node)` on a heading → sibling paragraph, not absorbed. |
| [#572](https://github.com/solo-ist/prose/issues/572) | P5 correctness | Full-node edit shouldn't clear annotations on unchanged words. |
| [#517](https://github.com/solo-ist/prose/issues/517) | P4 file-watcher | Refresh `modifiedAt` on external `change` events. |
| [#518](https://github.com/solo-ist/prose/issues/518) | P4 file-watcher | Catch events inside expanded subfolders. |
| [#531](https://github.com/solo-ist/prose/issues/531) | bug | HMR loses pending AI suggestions on Editor remount. |
| [#536](https://github.com/solo-ist/prose/issues/536) | infra (hybrid) | Sentry→GitHub auto-filing. Agent does labels + issue template; **Sentry-console setup is manual/human**. |
| [#566](https://github.com/solo-ist/prose/issues/566) | feature | Code-block syntax highlighting. |
| [#384](https://github.com/solo-ist/prose/issues/384) | feature | Publish Prose as a Homebrew Cask (self-distribution channel). |
| [#386](https://github.com/solo-ist/prose/issues/386) | feature | AI edits history on documents. |
| [#385](https://github.com/solo-ist/prose/issues/385) | feature | Quick Review redesign. |
| [#380](https://github.com/solo-ist/prose/issues/380) | feature | Projects & Favorites in the file explorer. |
| [#494](https://github.com/solo-ist/prose/issues/494) | docs | Fresh CLAUDE.md / docs accuracy audit. |

### Wave 0.5 — MAS Refresh · *active · Do Next*
Bundles with Wave 0's shipped QoL fixes so the **next MAS release** ships fixes + new branding + free pricing together. Driven by [`launch/wave-0.5-mas-refresh.md`](launch/wave-0.5-mas-refresh.md). Sequencing: debug #487 first (restores local MAS QA), then the hardening pair (#391, #376), then the cheap config/asset/copy bulk (#615, #612, #613), with #409/#317 deprioritized.

| Issue | Captures |
|---|---|
| [#615](https://github.com/solo-ist/prose/issues/615) | Drop the $0.99 price — ship the MAS build free (per MAS = free taste). |
| [#612](https://github.com/solo-ist/prose/issues/612) | Refresh App Store screenshots + icon for the new branding. |
| [#613](https://github.com/solo-ist/prose/issues/613) | Refresh App Store description + persona copy. |
| [#391](https://github.com/solo-ist/prose/issues/391) | Sentry CSP blocks `sentry-ipc` in MAS — land crash reporting on the free client. |
| [#487](https://github.com/solo-ist/prose/issues/487) | masDev local launch fails (Launchd 163) — restores local MAS QA. |
| [#376](https://github.com/solo-ist/prose/issues/376) | asar integrity fuses (hardens the self-distributed build too). |
| [#409](https://github.com/solo-ist/prose/issues/409) | MAS universal binary (arm64 + x64) — deprioritized; revisit if Intel demand shows. |
| [#317](https://github.com/solo-ist/prose/issues/317) | Agent-driven macOS UI testing via Circuit + Actions (test infra). |

### Wave 1 — Core Build-Out · *Later · three concurrent tracks, merge ladder A→B→C*

**Track A — A Smarter Desktop App** ([#596](https://github.com/solo-ist/prose/issues/596))
| Issue | Captures |
|---|---|
| [#604](https://github.com/solo-ist/prose/issues/604) | Agent tool: adaptive window/panel sizing. |
| [#605](https://github.com/solo-ist/prose/issues/605) | Agent tool: File Explorer control. |
| [#606](https://github.com/solo-ist/prose/issues/606) | Agent tool: allowlisted settings (never credentials/sandbox flags). |
| [#607](https://github.com/solo-ist/prose/issues/607) | The control model: gating, lock, undo, ask-first. |
| [#314](https://github.com/solo-ist/prose/issues/314) | Source-mode-aware chat + settings-editing tools. |
| [#533](https://github.com/solo-ist/prose/issues/533) | Per-tool tool-call result rendering (design pass). |
| [#556](https://github.com/solo-ist/prose/issues/556) | Streaming indicators (Thinking/Drafting) + fluid text. |
| [#260](https://github.com/solo-ist/prose/issues/260) | Universal slash commands — the command-palette surface. |

**Track B — reMarkable App Parity** ([#597](https://github.com/solo-ist/prose/issues/597)) — *validate scope via spike #616 first*
| Issue | Captures |
|---|---|
| [#608](https://github.com/solo-ist/prose/issues/608) | Notebook cover-image visualization. |
| [#609](https://github.com/solo-ist/prose/issues/609) | Notebook view. |
| [#610](https://github.com/solo-ist/prose/issues/610) | EPUB/PDF upload. |
| [#611](https://github.com/solo-ist/prose/issues/611) | Two-way typed-doc sync. |
| [#403](https://github.com/solo-ist/prose/issues/403) | PDF/text document sync. |
| [#466](https://github.com/solo-ist/prose/issues/466) | Expose `FAIL_RETRY_AFTER_MS` as a setting. |

**Track C — Paid Platform Foundation** ([#598](https://github.com/solo-ist/prose/issues/598)) — *build gated on spikes #601 + #602; children created once the stack is chosen*
| Issue | Captures |
|---|---|
| [#258](https://github.com/solo-ist/prose/issues/258) | Web-native build exploration (the web editor rides on the gateway). |
| [#364](https://github.com/solo-ist/prose/issues/364) | prose.solo.ist — interactive web shell / marketing site + blog. |

### Wave 2 — Generative Deep End · *On Hold · OSS-only*
| Issue | Captures |
|---|---|
| [#599](https://github.com/solo-ist/prose/issues/599) | **Epic:** terminal tab → sandboxed Claude Code CLI (checkout/change/PR or file issue) → deferred build/dist. |
| [#233](https://github.com/solo-ist/prose/issues/233) | Integrated Terminal — terminal tabs (the prerequisite). |
| [#219](https://github.com/solo-ist/prose/issues/219) | Bash CMS RFC — CLI-first content management; future Prose CLI. |
| [#439](https://github.com/solo-ist/prose/issues/439) | Hosted OCR as a web-gated entitlement (Paid Platform upsell; depends on Track C live). |

---

## Epics

| Epic | Phase | Milestone | Children / seeds |
|---|---|---|---|
| [#596](https://github.com/solo-ist/prose/issues/596) A Smarter Desktop App | Track A / Wave 1 | Wave 1 | #604–#607; #314, #533, #556, #260 |
| [#597](https://github.com/solo-ist/prose/issues/597) reMarkable App Parity | Track B / Wave 1 | Wave 1 | #608–#611; #403, #466 (scope via #616) |
| [#598](https://github.com/solo-ist/prose/issues/598) Paid Platform Foundation | Track C / Wave 1 | Wave 1 | #258, #364; gated on #601/#602; deferred child #439 |
| [#599](https://github.com/solo-ist/prose/issues/599) Generative Codebase | Wave 2 | Wave 2 | #233 (prereq), #219 |
| [#600](https://github.com/solo-ist/prose/issues/600) Authorship Annotations | placeholder | *(none)* | #525, #537, #570 |

---

## Deferred / parked (On Hold)

Not in any active wave. Tracked so they're not rediscovered as scope creep.

- **Authorship Annotations** (Later, placeholder epic [#600](https://github.com/solo-ist/prose/issues/600), no milestone): [#525](https://github.com/solo-ist/prose/issues/525) MCP authorship annotation · [#537](https://github.com/solo-ist/prose/issues/537) what/why triples · [#570](https://github.com/solo-ist/prose/issues/570) provenance for non-insert/edit content.
- **SpecScript / platform vision:** [#168](https://github.com/solo-ist/prose/issues/168), [#232](https://github.com/solo-ist/prose/issues/232), [#234](https://github.com/solo-ist/prose/issues/234).
- **Other vision/research:** [#235](https://github.com/solo-ist/prose/issues/235) enterprise infra · [#452](https://github.com/solo-ist/prose/issues/452) Claude Code plugin distribution · [#190](https://github.com/solo-ist/prose/issues/190) audio transcription · [#387](https://github.com/solo-ist/prose/issues/387) markitdown · [#298](https://github.com/solo-ist/prose/issues/298) release-manager skill · [#368](https://github.com/solo-ist/prose/issues/368) Google Docs early access.
- **Launch prerequisite:** [#120](https://github.com/solo-ist/prose/issues/120) Google OAuth prod verification — gates Google Docs sync shipping publicly (not a blocker for the spikes or Track C).
- **Deferred docs:** [#515](https://github.com/solo-ist/prose/issues/515) refresh skill/persona docs — wait until Track A reshapes the agent surface (in Later, no milestone).

## Open questions

- **Wave-1 headline** — which track leads the story: Smarter Desktop App or reMarkable parity?
- **Paid wedge** — "Prose anywhere" (web + gateway) vs. "Prose for reMarkable power users"? Hard to headline both.
- **Co-op mechanics** — governance, transparency, and how the shared-infra subsidy is set (parked research; not a Track C gate).
- **Generative terminal security model** — running a coding agent in a tab without breaking `sandbox: true` (Wave 2 discovery).

## Pointers

- **Live priority / queue:** [Project board #5](https://github.com/orgs/solo-ist/projects/5/views/1) (milestones mirror the waves).
- **Dev / security / build conventions, agent workflow:** [`../CLAUDE.md`](../CLAUDE.md).
- **Build-target gating (unified codebase):** [`architecture/adr-feature-flags.md`](architecture/adr-feature-flags.md).
- **Agent tool surface (for Track A):** [`architecture/llm-pipeline.md`](architecture/llm-pipeline.md).
- **Prior art for adaptive panel sizing:** [`spikes/panel-resize-behavior.md`](spikes/panel-resize-behavior.md).
