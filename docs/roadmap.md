# Prose Roadmap

**Status:** Active · **Updated:** 2026-06-07 · **Live priority:** [Project board #5](https://github.com/orgs/solo-ist/projects/5/views/1)

> **Reading this cold?** Top-to-bottom this tells you the strategy, the phase we're in, what to pick up next, and how work flows — enough to resume mid-stream. This doc is the narrative + operating model; the **project board is the live queue** and the **milestones mirror the waves**. For dev/security/build conventions, see [`../CLAUDE.md`](../CLAUDE.md).

---

## You are here

- **Active wave: Wave 0.5 — MAS Refresh** — *shipped to the App Store as v1.6.2 (build 29, approved); a v1.6.3 fast-follow is in TestFlight.* The hardening pair shipped ([#391](https://github.com/solo-ist/prose/issues/391) Sentry CSP via #656 · [#376](https://github.com/solo-ist/prose/issues/376) asar fuses via #662), the App Store copy landed ([#613](https://github.com/solo-ist/prose/issues/613) closed, #663/#693), and the screenshot assets + generator merged (#694, [#612](https://github.com/solo-ist/prose/issues/612) closed). The ASC config landed 2026-06-06: [#615](https://github.com/solo-ist/prose/issues/615) free pricing flipped and [#612](https://github.com/solo-ist/prose/issues/612) screenshots uploaded (both closed). The TestFlight loop uploaded **builds 23–31**.
- **v1.6.3 fast-follow (MAS only):** [#654](https://github.com/solo-ist/prose/issues/654) (the MAS base-root bookmark loss on project add/switch) shipped in #711 → **build 31 VALID on App Store Connect, TestFlight QA passed** (2026-06-07). Two App-Store-delivery boundaries learned in the process — *an approved version closes its train* and *a failed upload burns its build number* — are now codified in [`launch/wave-0.5-mas-refresh.md`](launch/wave-0.5-mas-refresh.md). No GitHub release was cut (the fix is MAS-gated/inert on desktop). **Remaining — all human, in ASC:** submit v1.6.3 for review · App Privacy label → optional **Crash Data (not linked)** per #391 · [#487](https://github.com/solo-ist/prose/issues/487) Apple provisioning steps.
- **[#487](https://github.com/solo-ist/prose/issues/487) is diagnosed** (2026-06-02): a provisioning gap, not a cert problem — the valid `Apple Development` cert is already under the MAS team (team = cert `OU`, not the CN parenthetical). The fix is regenerating `build/Prose_Development.provisionprofile` (+ confirming device registration) — a human Apple-account action. Local MAS QA stays broken until then; TestFlight remains the verification path.
- **Formally parked out of the 0.5 scope** (2026-06-06): [#409](https://github.com/solo-ist/prose/issues/409) universal binary (**On Hold** — revisit if Intel demand shows) and [#317](https://github.com/solo-ist/prose/issues/317) agent-driven macOS UI testing (**Later** — test infra, not release-gating).
- **Hard boundary:** never submit for App Store review — TestFlight upload is the automation edge; submission is a human action. MAS `buildVersion` is global-monotonic — never reset it on a marketing-version bump.
- **Wave 0 — done.** Shipped in **v1.5.0** (2026-05-28 — P1–P5 bug/QoL batch + [#641](https://github.com/solo-ist/prose/issues/641) HTML export) and **v1.6.0** (2026-06-01 — [#385](https://github.com/solo-ist/prose/issues/385) Quick Review redesign · [#386](https://github.com/solo-ist/prose/issues/386) AI edits history · [#380](https://github.com/solo-ist/prose/issues/380) Projects & Favorites first pass), followed by **v1.6.1** (2026-06-02 — #645 annotation visibility, #646 reopen-closed-tab, #648 comment anchoring, reMarkable fixes #652/#667). **v1.6.2** (2026-06-05) is now the latest published GitHub release — the TestFlight-loop hardening batch (inline-markdown accept #671 · AI-pipeline instrumentation #675 · block-type conversion #676 · annotation robustness #677 · node-id dedup #682 · Activity-panel redesign #685 · chat-actions fix #689) plus the README/screenshot refresh (#692/#694). [#380](https://github.com/solo-ist/prose/issues/380) Projects & Favorites is **fully closed** — its held-back remainder (MAS bookmark activation) shipped via [#654](https://github.com/solo-ist/prose/issues/654)/v1.6.3. Stragglers still open: [#384](https://github.com/solo-ist/prose/issues/384) Homebrew Cask (now unblocked by the notarized DMG) and [#536](https://github.com/solo-ist/prose/issues/536) Sentry→GitHub (hybrid: agent repo slice + manual Sentry-console slice).
- **Next desktop batch** (*Do Next*, unmilestoned — filed in the 2026-06-06 refinement, none started yet): [#699](https://github.com/solo-ist/prose/issues/699) comment threading (folds #665) · [#700](https://github.com/solo-ist/prose/issues/700) extended-thinking blocks + dynamic streaming verbs (supersedes #556, pulled forward out of Track A) · [#703](https://github.com/solo-ist/prose/issues/703) file-explorer interactivity. ([#654](https://github.com/solo-ist/prose/issues/654), the fourth member, shipped in v1.6.3.) Quick Wins picked up #704, #696, #655, #664, #686.
- **New epic: [#697](https://github.com/solo-ist/prose/issues/697) Project Mode** (*Later*) — projects as a first-class working context: save location ([#705](https://github.com/solo-ist/prose/issues/705), ungated) · agentic project search ([#706](https://github.com/solo-ist/prose/issues/706)) · intelligent context management ([#707](https://github.com/solo-ist/prose/issues/707)) · adopted child [#653](https://github.com/solo-ist/prose/issues/653). **Key sequencing shift:** the intelligence pillars (#706/#707) and agent memory ([#708](https://github.com/solo-ist/prose/issues/708)) are **gated on [#599](https://github.com/solo-ist/prose/issues/599)** — the Generative Codebase epic is now the intended agent runtime for these workloads, elevating it from pure Wave-2 deferral to a load-bearing prerequisite (see Open questions).
- **Next:** **Wave 1 — Core Build-Out** — three concurrent tracks on the **A→B→C merge ladder**, gated by the spikes ([#601](https://github.com/solo-ist/prose/issues/601)/[#602](https://github.com/solo-ist/prose/issues/602) for Track C, [#616](https://github.com/solo-ist/prose/issues/616) for Track B — closeout recommendation posted, pending ratification).
- **Deferred (On Hold):** Wave 2 (Generative Codebase — but see the #599 elevation above), the #599-gated cluster (#706/#707/#708), #409 universal binary, vision/research, and the parked Authorship Annotations cluster.

## How work flows (operating model)

- **Column = phase, milestone = wave:**
  | Column | Phase |
  |---|---|
  | **Do First** + **Quick Wins** | priority/bigger vs. small — Wave 0 is done; Quick Wins holds the small-fix tail |
  | **Do Next** | Wave 0.5's human (ASC) tail + the next desktop batch (#699/#700/#703) |
  | **Later** | Wave 1 + its spikes + Project Mode (#697) + design/UX backlog (#698/#701/#702) + parked-but-tracked (Annotations) |
  | **On Hold** | deferred: Wave 2, the #599-gated cluster (#706/#707/#708), #409, vision/research, launch gates |
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
| [#616](https://github.com/solo-ist/prose/issues/616) | Research the official reMarkable app + competitive landscape to validate Track B's parity scope before building it. **Closeout recommendation posted (2026-05-27)** — anchor on #403 → #610 → #611 → AI-summary-on-import; pending ratification, so the issue stays open as the decision record. |
| [#710](https://github.com/solo-ist/prose/issues/710) | **Boox + Supernote** e-ink landscape beyond reMarkable — viable sync paths per device, OCR-pipeline reuse, provider-abstraction decision (with #638), and whether multi-device widens or dilutes Track B's wedge. #616's method; informs Track B scope, doesn't gate it. |

### Wave 0 — QoL & Bug Fixes · *done — shipped v1.5.0 + v1.6.0 + v1.6.1*
Shipped as sequenced cloud-agent batches + local QA. The P1–P5 bug/QoL batch landed in v1.5.0; the three features (#385/#386/#380) in v1.6.0; a follow-up batch (#645/#646/#648/#652/#667) in v1.6.1. #380's MAS-bookmark follow-up (#654) shipped in v1.6.3, closing #380. Stragglers still open: #384 (Homebrew) and #536 (Sentry→GitHub hybrid).

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

### Wave 0.5 — MAS Refresh · *active · code complete — remaining steps are human (ASC)*
Bundles with Wave 0's shipped QoL fixes so the **next MAS release** ships fixes + new branding + free pricing together. Driven by [`launch/wave-0.5-mas-refresh.md`](launch/wave-0.5-mas-refresh.md). The agent-side work is done — hardening pair merged, copy + screenshot assets shipped, **v1.6.2** cut, TestFlight builds 23–29 uploaded — and the ASC config (free pricing, screenshot upload) landed 2026-06-06. What's left is human, in App Store Connect: the App Privacy label (optional Crash Data, not linked), #487's provisioning steps, and review submission (never automated).

| Issue | Captures | Status |
|---|---|---|
| [#615](https://github.com/solo-ist/prose/issues/615) | Drop the $0.99 price — ship the MAS build free (per MAS = free taste). | ✅ done — flipped in ASC (closed 2026-06-06) |
| [#612](https://github.com/solo-ist/prose/issues/612) | Refresh App Store screenshots + icon for the new branding. | ✅ done — assets merged (#694) + uploaded to ASC (closed 2026-06-06) |
| [#613](https://github.com/solo-ist/prose/issues/613) | Refresh App Store description + persona copy. | ✅ shipped (#663/#693) |
| [#391](https://github.com/solo-ist/prose/issues/391) | Sentry CSP blocks `sentry-ipc` in MAS — land crash reporting on the free client. | ✅ shipped (#656) |
| [#487](https://github.com/solo-ist/prose/issues/487) | masDev local launch fails (Launchd 163) — restores local MAS QA. | diagnosed (provisioning gap); human Apple steps remain |
| [#376](https://github.com/solo-ist/prose/issues/376) | asar integrity fuses (hardens the self-distributed build too). | ✅ shipped (#662) |
| [#409](https://github.com/solo-ist/prose/issues/409) | MAS universal binary (arm64 + x64) — revisit if Intel demand shows. | parked (On Hold) |
| [#317](https://github.com/solo-ist/prose/issues/317) | Agent-driven macOS UI testing via Circuit + Actions (test infra). | deprioritized (Later) |

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
| [#260](https://github.com/solo-ist/prose/issues/260) | Universal slash commands — the command-palette surface. |

*(#556 streaming indicators was superseded by [#700](https://github.com/solo-ist/prose/issues/700) and pulled forward into the Do Next desktop batch.)*

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

**Design & UX backlog** (*Later*, unassigned to a track — filed 2026-06-06): [#698](https://github.com/solo-ist/prose/issues/698) Settings redesign (left-nav focus modal; Claude Design spike first) · [#701](https://github.com/solo-ist/prose/issues/701) customizable "…" menus (wiggle edit mode) · [#702](https://github.com/solo-ist/prose/issues/702) projects/favorites drag-reorder + sort toggle. Independent of the merge ladder; slot alongside any wave.

### Project Mode — epic [#697](https://github.com/solo-ist/prose/issues/697) · *Later · pillar 1 free; pillars 2–3 gated on #599*
Projects as a first-class working context (filed 2026-06-06): having a project "open" puts the app in project mode. Search stays **local-first / DWeb-friendly** — agentic grep+read first, upgrade path local BM25 → local vectors; hosted embedding APIs are explicitly out.

| Issue | Captures |
|---|---|
| [#705](https://github.com/solo-ist/prose/issues/705) | Project-mode default save location = project root (derived, never writes `defaultSaveDirectory`). **Ungated** — can ride any batch. |
| [#706](https://github.com/solo-ist/prose/issues/706) | Agentic project search tools for chat (`search_project` / `read_project_file`). Gated on #599. |
| [#707](https://github.com/solo-ist/prose/issues/707) | Intelligent project context management for chat (implicit counterpart to #653). Gated on #599. |
| [#653](https://github.com/solo-ist/prose/issues/653) | Workspace-style `@project` chat context — adopted existing child (the explicit invocation surface). |

### Wave 2 — Generative Deep End · *On Hold · OSS-only — but now load-bearing*
**Elevation note (2026-06-06):** #599 is no longer pure deferral — it is the intended **agent runtime** for the Project Mode intelligence pillars (#706/#707) and agent memory (#708), all of which are gated on it. That strengthens the case for pulling it forward once Wave 1 planning settles (see Open questions).

| Issue | Captures |
|---|---|
| [#599](https://github.com/solo-ist/prose/issues/599) | **Epic:** terminal tab → sandboxed Claude Code CLI (checkout/change/PR or file issue) → deferred build/dist. Now gates #706/#707/#708. |
| [#233](https://github.com/solo-ist/prose/issues/233) | Integrated Terminal — terminal tabs (the prerequisite). |
| [#219](https://github.com/solo-ist/prose/issues/219) | Bash CMS RFC — CLI-first content management; future Prose CLI. |
| [#439](https://github.com/solo-ist/prose/issues/439) | Hosted OCR as a web-gated entitlement (Paid Platform upsell; depends on Track C live). |
| [#708](https://github.com/solo-ist/prose/issues/708) | Persistent agent memory — preferences/approaches/voice (`save_memory` tool, settings panel). Spike first; rides the #599 runtime. |

---

## Epics

| Epic | Phase | Milestone | Children / seeds |
|---|---|---|---|
| [#596](https://github.com/solo-ist/prose/issues/596) A Smarter Desktop App | Track A / Wave 1 | Wave 1 | #604–#607; #314, #533, #260 (#556 → superseded by #700, pulled forward) |
| [#597](https://github.com/solo-ist/prose/issues/597) reMarkable App Parity | Track B / Wave 1 | Wave 1 | #608–#611; #403, #466 (scope via #616) |
| [#598](https://github.com/solo-ist/prose/issues/598) Paid Platform Foundation | Track C / Wave 1 | Wave 1 | #258, #364; gated on #601/#602; deferred child #439 |
| [#599](https://github.com/solo-ist/prose/issues/599) Generative Codebase | Wave 2 — elevated: gates #706/#707/#708 | Wave 2 | #233 (prereq), #219 |
| [#697](https://github.com/solo-ist/prose/issues/697) Project Mode | straddles: #705 ungated; #706/#707 post-#599 | *(none)* | #705, #706, #707; adopted #653 |
| [#600](https://github.com/solo-ist/prose/issues/600) Authorship Annotations | placeholder | *(none)* | #525, #537, #570 |

---

## Deferred / parked (On Hold)

Not in any active wave. Tracked so they're not rediscovered as scope creep.

- **#599-gated cluster** (On Hold until the Generative Codebase epic lands its runtime): [#706](https://github.com/solo-ist/prose/issues/706) agentic project search · [#707](https://github.com/solo-ist/prose/issues/707) project context management · [#708](https://github.com/solo-ist/prose/issues/708) agent memory (spike first).
- **MAS extras:** [#409](https://github.com/solo-ist/prose/issues/409) universal binary — formally parked 2026-06-06; revisit if Intel demand shows.
- **Authorship Annotations** (Later, placeholder epic [#600](https://github.com/solo-ist/prose/issues/600), no milestone): [#525](https://github.com/solo-ist/prose/issues/525) MCP authorship annotation · [#537](https://github.com/solo-ist/prose/issues/537) what/why triples · [#570](https://github.com/solo-ist/prose/issues/570) provenance for non-insert/edit content.
- **SpecScript / platform vision:** [#168](https://github.com/solo-ist/prose/issues/168), [#232](https://github.com/solo-ist/prose/issues/232), [#234](https://github.com/solo-ist/prose/issues/234).
- **Other vision/research:** [#235](https://github.com/solo-ist/prose/issues/235) enterprise infra · [#452](https://github.com/solo-ist/prose/issues/452) Claude Code plugin distribution · [#190](https://github.com/solo-ist/prose/issues/190) audio transcription · [#387](https://github.com/solo-ist/prose/issues/387) markitdown · [#298](https://github.com/solo-ist/prose/issues/298) release-manager skill · [#368](https://github.com/solo-ist/prose/issues/368) Google Docs early access.
- **Launch prerequisite:** [#120](https://github.com/solo-ist/prose/issues/120) Google OAuth prod verification — gates Google Docs sync shipping publicly (not a blocker for the spikes or Track C).
- **Deferred docs:** [#515](https://github.com/solo-ist/prose/issues/515) refresh skill/persona docs — wait until Track A reshapes the agent surface (in Later, no milestone).

## Open questions

- **Wave-1 headline** — which track leads the story: Smarter Desktop App or reMarkable parity?
- **Pull #599 forward?** The terminal/agent-runtime epic now gates Project Mode intelligence (#706/#707) and agent memory (#708) — does it stay Wave 2, or move up once Wave 1 planning settles?
- **Paid wedge** — "Prose anywhere" (web + gateway) vs. "Prose for reMarkable power users"? Hard to headline both.
- **BYOK / multi-provider ([#683](https://github.com/solo-ist/prose/issues/683))** — the Anthropic-only stance is softening (2026-06-06); how does BYOK interact with the paid gateway/metering model (Track C)?
- **Co-op mechanics** — governance, transparency, and how the shared-infra subsidy is set (parked research; not a Track C gate).
- **Generative terminal security model** — running a coding agent in a tab without breaking `sandbox: true` (Wave 2 discovery).

## Pointers

- **Live priority / queue:** [Project board #5](https://github.com/orgs/solo-ist/projects/5/views/1) (milestones mirror the waves).
- **Dev / security / build conventions, agent workflow:** [`../CLAUDE.md`](../CLAUDE.md).
- **Build-target gating (unified codebase):** [`architecture/adr-feature-flags.md`](architecture/adr-feature-flags.md).
- **Agent tool surface (for Track A):** [`architecture/llm-pipeline.md`](architecture/llm-pipeline.md).
- **Prior art for adaptive panel sizing:** [`spikes/panel-resize-behavior.md`](spikes/panel-resize-behavior.md).
