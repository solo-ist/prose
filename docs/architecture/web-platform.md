# Prose on the Web — Web Foundations Epic

**Status:** Planning (reconciled to Foundations MVP) · **Created:** 2026-06-13 · **Reconciled:** 2026-06-15 (spike split — 3 discovery spikes + 7 build phases) · **Infra decisions:** 2026-06-30 (Prisma 7, Render, Hover DNS, storage split — see §7) · **Owner:** Angel
**Parent epic:** Track C — Paid Platform Foundation ([#598](https://github.com/solo-ist/prose/issues/598))
**Children (filed 2026-06-15; native sub-issues of #598):** spikes [#601](https://github.com/solo-ist/prose/issues/601) · [#775](https://github.com/solo-ist/prose/issues/775) · [#776](https://github.com/solo-ist/prose/issues/776) — then phases [#765](https://github.com/solo-ist/prose/issues/765) · [#766](https://github.com/solo-ist/prose/issues/766) · [#767](https://github.com/solo-ist/prose/issues/767) · [#768](https://github.com/solo-ist/prose/issues/768) · [#769](https://github.com/solo-ist/prose/issues/769) · [#770](https://github.com/solo-ist/prose/issues/770) · [#771](https://github.com/solo-ist/prose/issues/771)
**Threads into:** web build ([#258](https://github.com/solo-ist/prose/issues/258), superseded), prose.solo.ist ([#364](https://github.com/solo-ist/prose/issues/364)), billing spike ([#602](https://github.com/solo-ist/prose/issues/602), resolved). Discovery spikes are children: [#601](https://github.com/solo-ist/prose/issues/601) auth · [#775](https://github.com/solo-ist/prose/issues/775) SSE · [#776](https://github.com/solo-ist/prose/issues/776) comment-sync.

> This is the canonical planning narrative for Prose's first real web surface. It was **reconciled on 2026-06-15** from the broader 2026-06-13 draft down to a **Foundations MVP**: accounts, a backend, server-side storage, hash-gated share links, and a thin at-cost paid tier. Everything beyond that (AtProto, Nostr, DWeb hosting, multi-provider LLM, managed published pages, real-time/CRDT comments) is preserved in a clearly-marked **Deferred** section (§8) with its seam kept open. Read `../roadmap.md` for wave context and `../../CLAUDE.md` for conventions.

---

## 1. What we're building (the Foundations MVP)

One epic — **Web Foundations** — that delivers five fundamentals on top of a single backend (the **gateway**). Everything else layers on later.

1. **Accounts / registration** — email magic-link to start, behind an *Account ⟂ credential* model so Nostr / AtProto / Google are additive later.
2. **Backend web service** — a self-hostable **monolith** (the gateway) that does auth, document storage, share-link serving, comment sync, and an **LLM proxy**.
3. **Subscription + entitlements** — one cheap **at-cost** plan, modeled so co-op/non-profit funding is a future experiment, not a corner we coded ourselves into.
4. **Frontend, user-facing** — once logged in, the full Prose web experience, with **server-side storage** for markdown *and* published HTML.
5. **Frontend, share-facing** — share a markdown or HTML file via a **hash-protected URL**. HTML = the flat file served directly. Markdown = the full Prose editing UI minus the File Explorer, where an invited reviewer can **comment and reply**.

**Key reframe:** the renderer *already runs in a browser* (§3). The net-new work is the **backend + a share viewer**, not "porting to the browser."

---

## 2. How this maps to the roadmap

This epic is the product layer of **Track C — Paid Platform Foundation ([#598](https://github.com/solo-ist/prose/issues/598))**. It concretizes existing issues and concludes the two gating spikes.

| Roadmap item | Action |
| --- | --- |
| [#598](https://github.com/solo-ist/prose/issues/598) Paid Platform Foundation (epic) | **Parent.** 3 spikes (#601/#775/#776) + 7 phases (#765–771) tracked as native sub-issues. |
| [#258](https://github.com/solo-ist/prose/issues/258) Web version + HTML/publishing | **Closed (superseded)** by #598 + children #765–771. |
| [#364](https://github.com/solo-ist/prose/issues/364) prose.solo.ist (marketing shell + blog) | **Domain coordination** — the gateway + `/s/:token` serving share the domain. |
| [#601](https://github.com/solo-ist/prose/issues/601) Auth spike | **Resolved (2026-06-28) → Better Auth** (self-hostable, no Auth0); Account⟂credential + origin/CSRF settled. Fed #765. |
| [#775](https://github.com/solo-ist/prose/issues/775) SSE-proof spike | **New** — prove Anthropic SSE through Hono `streamSSE`; renderer protocol intact; gates #765/#766. |
| [#776](https://github.com/solo-ist/prose/issues/776) comment-sync design spike | **New** — bidirectional sync design (google/sync.ts model); reconciles #699; gates #769. |
| [#602](https://github.com/solo-ist/prose/issues/602) Billing/metering spike | **Resolved** — one at-cost plan; entitlements decoupled from billing via a `granted_by` seam; impl in Phase 4 (#770). |
| [#699](https://github.com/solo-ist/prose/issues/699) comment threading | **Coordinated** — share comments (3a/3b) reuse its threading + resolved-state model, not a parallel schema. |
| [#685](https://github.com/solo-ist/prose/issues/685) (merged) / [#386](https://github.com/solo-ist/prose/issues/386) (closed) Activity history | **Reused** — Phase 3b extends the Activity projection for resolved-comment history. |
| [#683](https://github.com/solo-ist/prose/issues/683) BYOK · [#120](https://github.com/solo-ist/prose/issues/120) Google verify | Deferred; see §8 + §9. |

**Distribution model holds:** MAS is the free taste; paid lives on the self-distributed / web account layer (no Apple IAP). A MAS client may *sign in* to consume an externally-bought subscription (reader-app pattern) but must not advertise the purchase (anti-steering). Unified codebase, gated by build target + feature flags (§5).

---

## 3. What already exists (audit, verified 2026-06-15)

The renderer is **already web-capable**. The gap is a backend + identity layer.

| Area | State | Reuse |
| --- | --- | --- |
| **Web build** (`vite.web.config.ts`, `web-main.tsx`, `web-index.html`, `lib/webApi.ts`) | ✅ Works. Builds to `dist/web/`, mounts the real `<App/>` with a mock `window.api`. Scripts `dev:web`/`build:web`/`test:web`; 4 `e2e/web*.spec.ts`. | The shell of the web app + share viewer. Needs a **router** and a **single-doc view**. |
| **Cross-platform seam** (`getApi()`, `browserApi.ts`, `ElectronAPI` in `types/index.ts`) | ✅ Mature. All renderer code calls `getApi()`. **LLM is CORS-blocked** in-browser → today a stub. | Where the gateway client plugs in. `llmChatStream()` reroutes to the proxy; keep the `llm:stream:*` window-event protocol so `useChat` is untouched. |
| **HTML export** (`lib/htmlExport.ts` `buildProseHtml()`) | ✅ Standalone, round-trippable (inline CSS, base64 images, embedded markdown). | **Directly the flat-HTML share artifact.** |
| **Comments** (`extensions/comments/*`, IndexedDB `comments` store) | ⚠️ Local-only TipTap marks. `CommentData = {id, markedText, comment, createdAt, occurrenceIndex?, from, to}`, anchored by `markedText` + `occurrenceIndex` (**position-independent → network-portable**), stripped from `.md`. **Resolving DELETES the comment** (`unsetComment`). No authorship, no sync. | The biggest net-new work: authorship + a **sync engine** (3b) + resolution-to-history. |
| **Google sync** (`main/google/sync.ts`) | ✅ Bidirectional, **timestamp newest-wins** (no CRDT), per-doc `GoogleDocEntry` keyed by stable remote id, persisted to `.google/sync-metadata.json`; `getSyncMetadata`/`updateSyncMetadataEntry`/`removeSyncMetadataEntry` IPC. | **The model for comment sync** (3b): stable IDs, per-doc sync-metadata, newest-wins. |
| **Activity tab** (`AIEditsHistoryPanel`) | ✅ A **pure projection of `useAnnotationStore`** (no separate ledger; `detached:true` keeps overwritten entries as immutable history). Comments are **not** in it yet. | Phase 3b extends this projection to resolved comments. |
| **Auth/secrets** (`main/google/auth.ts`, `credentialStore.ts`) | ✅ Local-redirect OAuth + `safeStorage` keychain. | Generalize the *concept*; store the gateway session token via `credentialStore`. Web needs a backend redirect. |
| **Feature flags** (`lib/featureFlags.ts`) | ✅ `googleDocs` (opt-in), `remarkable` (on desktop / forced-off MAS via `isMasBuild()`). | New `webPlatform` flag, opt-in (`=== true`), MAS-gated. |

---

## 4. Architecture — the new pieces

```
                    ┌────────────── gateway/ (self-hostable monolith, prose.solo.ist) ──────────────┐
 Prose desktop      │  Hono + @hono/node-server · Postgres (Prisma 7) · Cloudflare R2 (blobs)        │
   getApi() ─IPC──▶ │  /api/auth/*       magic-link via a self-hostable auth library (engine = spike)│
   account:* share:*│  /api/llm/stream   GATED by ai_proxy entitlement → Anthropic SSE  ◀ meter point │
                    │  /api/documents/*  server-owned markdown CRUD (web users)                      │
 Prose web      ──▶ │  /api/comments/*   threaded comment sync (one-way 3a → bidirectional 3b)        │
   fetch()          │  GET /s/:token     html → flat HTML;  markdown → share viewer SPA               │
 Reviewer's     ──▶ │  entitlements (granted_by seam) · sessions · llm_usage (write-only)             │
   browser          └──────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 The gateway (the long pole)
A **portable, self-hostable Node monolith** — Hono + Postgres (**Prisma 7**) + Cloudflare R2 — kept as one process for **self-hostability** (the co-op value), native streaming for the LLM proxy, and a clean path to add custom signature-based auth later. For the MVP it deploys to **Render** (managed web service + managed Postgres) with **DNS on Hover** and **Render-managed TLS** — but nothing pins it there; the fallback is a self-managed VPS (Hetzner/DO). See §7 for the infra decisions. Responsibilities: accounts, server-side document storage, share-link store + serving, comment sync, the LLM proxy, and entitlements.

- **LLM proxy** — renderer → gateway → Anthropic. Solves the web-mode CORS wall *and* is the metering chokepoint. **It is GATED from day one** by an `ai_proxy` entitlement / beta allowlist (Angel is the only user initially) — never an ungated proxy on the operator's key. `llm_usage` is a **write-only meter, not the gate**.

### 4.2 Identity (reframes #601)
**Account ⟂ credential.** A stable internal **Account** owns entitlements and documents; each auth method is a linked **credential** row (`type ∈ email_magic_link | google | nostr | atproto`). Entitlements attach to the Account, never to a provider — so additional identities are additive and never cost a user their subscription.

- **MVP = email magic-link only**, via **Better Auth** (self-hostable; the resolved **#601** pick, 2026-06-28) with its **Prisma adapter**. **Do not hand-roll session/token crypto.**
- Google / AtProto / Nostr → **Deferred** (§8); the credential row + a `verifyCredential(type, payload)` dispatch are the kept seams.

### 4.3 Share service
- **Capability URL:** `https://prose.solo.ist/s/<token>`, token = 32 random bytes (256-bit). The server stores only `SHA-256(token)`; the raw token lives only in the URL → a DB dump never exposes live links.
- `GET /s/:token`: `html_share` → serve the stored flat HTML directly; `markdown_share` → serve the share SPA with the snapshot injected (same pattern `htmlExport.ts` uses for embedded markdown).
- **Commenter identity:** **no account required.** A reviewer gives a display name + an **optional email used only for reply notifications**, plus a *very unpushy, optional* "create a Prose account" nudge — the captured email is a one-click magic-link seed.
- Hardening: `Referrer-Policy: no-referrer`, rate-limit `/s/*`, revocation, optional expiry.

### 4.4 Share-facing markdown viewer
A **new sibling mount**, not a flag on `<App/>` (too entangled with `useTabStore`/`usePanelLayout`/toolbar): `src/renderer/share-main.tsx` + `share-index.html` (2nd Rollup input) + `components/share/*`. Read-mostly TipTap (same extensions as `Editor.tsx` minus `AISuggestion`/`AIAnnotations`/`NodeIds`; **keep the Comment mark**). Comments are served by a network-backed store, not IndexedDB.

### 4.5 Comment sync (3b) — modeled on Google Docs sync
Async **bidirectional**, **stable comment IDs** across local IndexedDB + server, a **per-doc sync-metadata record** (cf. `GoogleDocEntry`), **newest-wins**, **no CRDT**. On re-publish, **re-anchor by `markedText`**; anchors that no longer match are **flagged "anchor lost" and KEPT**. **Resolving preserves the thread as history** in the Activity tab — never deletes (today it deletes). The protocol is the **#776** spike's deliverable, reconciled with #699 so the threading + resolved-state model is built once; **#769** implements it and depends on #776's design artifact, not on #699's merge.

---

## 5. Security & MAS

- **Sharing = uploading a copy.** Local-first still holds: the file on disk stays the source of truth; a share deliberately copies a snapshot to the gateway. Make it explicit, visible, revocable; deleting the share deletes the server copy.
- **Origin + CSRF (decided in the #601 auth spike):** choose same-origin (SPA + gateway) vs cross-origin, and protect cookie-authed endpoints (`/api/llm/stream`, `/api/documents/*`) with **SameSite + CSRF tokens**, or switch to **bearer-token** auth. CSRF must not be left unaddressed.
- **Capability tokens** are bearer secrets: TLS-only, no logging, no Referer leakage, revocable.
- **Credentials** → `credentialStore` (`safeStorage`) only, never plaintext, never `homedir()`. No keys in `settings.json`.
- **Cross-surface sync is punted** — desktop stays local-first; web docs are server-owned; the only bridge is explicit publish/share. Keep the **storage interface abstract** so all-surfaces sync is additive.
- **MAS seams (#771):** gate every web-platform desktop surface behind the `webPlatform` flag **and** `IS_MAS_BUILD` (force-off, like reMarkable). Reader-app sign-in only — no IAP, no purchase/upsell UI (anti-steering). Skip MAS hardening for now; just keep the seams.
- **No `innerHTML` with shared/LLM content** — rendered through the existing safe path.

---

## 6. Phased plan (filed children)

**Spikes to tackle first (Do First, parallelizable):** **#601** (auth engine + Account⟂credential + origin/CSRF) ∥ **#775** (prove Anthropic SSE through Hono) ∥ **#776** (comment-sync design, reconciles #699). Their outputs gate the build below — #601 + #775 feed #765/#766, #776 feeds #769. Pair #776 with #699 (currently Do First) at design time.

| Phase | Issue | Scope | Sequencing |
| --- | --- | --- | --- |
| **0** | [#765](https://github.com/solo-ist/prose/issues/765) | Gateway scaffold (Hono+PG+**Prisma 7**+R2) + deploy to **Render** (Hover CNAME → Render, Render-managed TLS). (Auth-library, origin/CSRF, SSE, and comment-sync work split into spikes #601/#775/#776.) | Skeleton ∥ spikes; auth+SSE integration gate on #601/#775 |
| **1** | [#766](https://github.com/solo-ist/prose/issues/766) | Accounts (`account:*` IPC + preload + `ElectronAPI`); **gated** LLM proxy (`ai_proxy` minimal allowlist, generalized in #770); web router + gateway client behind `getApi()`; `webPlatform` flag; `llm_usage` write-only meter. | After 0 (#765) |
| **2** | [#767](https://github.com/solo-ist/prose/issues/767) | Server-side document storage; `serverApi.ts` over the abstract storage interface; swap the web mock. | After 1 (#766) |
| **3a** | [#768](https://github.com/solo-ist/prose/issues/768) | `publications` + hashed token; `GET /s/:token` (flat HTML / share SPA); `share-main.tsx` + read-mostly viewer; **one-way** comments (name + optional email + account nudge). | After 2 (#767); coordinates #699 |
| **3b** | [#769](https://github.com/solo-ist/prose/issues/769) | **Bidirectional** comment sync (Google-sync-modeled); re-anchor by `markedText` + "anchor lost"; **resolution-to-history** (extend the Activity projection). **Implements the #776 design.** | After 3a (#768); depends on #776, not #699's merge; reuses #685/#386 |
| **4** | [#770](https://github.com/solo-ist/prose/issues/770) | `entitlements` + gateway middleware; **manual/beta-invite grants**; `granted_by` seam + **unwired Stripe skeleton**; `sessions` for revocation. | After 1; resolves #602 |
| **×-cut** | [#771](https://github.com/solo-ist/prose/issues/771) | MAS seams + `webPlatform` flag across all surfaces. | Spans all |

---

## 7. Decisions captured

**From clarifying questions (2026-06-14):**
- **Backend:** self-managed **Hono + Postgres + Cloudflare R2** monolith.
- **Commenter identity:** no account; **optional notification email** + a very-unpushy optional account nudge.
- **Desktop ↔ web:** **publish-on-intent only** (no background sync).
- **Paid tier:** **entitlements + manual grants** (no payment collection yet).

**From corrections (2026-06-15):**
1. LLM proxy **gated from Phase 1** (`ai_proxy` entitlement); meter is write-only, not the gate.
2. **Origin/CSRF** decided in the #601 auth spike; cookie endpoints get SameSite+CSRF or bearer auth.
3. Auth engine: **drop Auth0**; self-hostable library inside the monolith; **#601 resolved → Better Auth** (2026-06-28), used via its Prisma adapter.
4. Comments = a **sync engine** modeled on `google/sync.ts` (stable IDs, per-doc sync-metadata, newest-wins, no CRDT); resolution **preserves to Activity history**, never deletes; re-anchor by `markedText`, "anchor lost" kept. **Split into 3a/3b**; coordinate #699.
5. **MAS** seams kept (flag + `IS_MAS_BUILD`, reader-app, `safeStorage`); no MAS hardening now.
6. **Cross-surface sync punted**; storage interface abstract.
7. **Billing:** one at-cost plan + entitlements + `granted_by` seam + unwired Stripe skeleton; **resolves #602**.

**Refinement (2026-06-15):** the discovery work was split into three discrete spikes — **#601** (auth engine + Account⟂credential + origin/CSRF), **#775** (SSE-through-Hono proof), **#776** (comment-sync design) — and **#765** slimmed to scaffold + deploy. All three spikes sit in **Do First** on the *Spikes — Discovery & De-risking* milestone (moved there 2026-06-16 when the explorations kicked off); the seven build phases are on *Wave 1*.

**Infrastructure decisions (2026-06-30):** with #601 resolved (Better Auth) and #775 proven (SSE-through-Hono, 15/15), Phase 0 (#765) moved to **Do First** and these infra choices were locked:

1. **ORM = Prisma 7** (over Drizzle) — safer migrations / reliable rename detection vs Drizzle Kit's destructive drop+create risk, Prisma Studio for inspecting accounts/entitlements, Better Auth's first-class Prisma adapter; Prisma 7 dropped the Rust engine (~1.6 MB / ~90 ms cold start), and Drizzle's bundle/edge advantage is irrelevant on a long-running Node service. *Constraint:* Prisma 7 compiles its query-compiler WASM at runtime — fine on Render (Node), would break on a Cloudflare Workers / edge runtime.
2. **Deploy = Render** (managed web service running the Docker image as a persistent process + managed Postgres, from $6/mo). **DNS = Hover** (`api.prose.solo.ist` CNAME → the Render target) with **Render-managed TLS (Let's Encrypt)**; **no CDN/proxy** in front (Cloudflare's only role in this stack is R2). Chosen over Fly for flat pricing, AWS-backed reliability, and cheap managed Postgres; **validated via a go/no-go gate** (SSE-unbuffered + Prisma-migrate-over-SSL on prod) before lock-in; VPS (Hetzner/DO) is the fallback, not Fly.
3. **Render buffers SSE by default** — the LLM-proxy route **must** set **`X-Accel-Buffering: no`** (+ `Cache-Control: no-cache`, `Connection: keep-alive`) and flush headers immediately. Render allows 100-minute responses, so long generations aren't cut (tune Node `keepAliveTimeout`/`headersTimeout`).
4. **Storage split:** document **content is markdown text → Postgres** (the #767 `documents` table), **never** object storage; **R2 holds binary blobs only** (embedded images, attachments, flat-HTML share snapshots, future hosted-OCR #439), **stubbed in Phase 0** (prove SDK/env). **No Render Disks** (a single-instance attachment pins the service to one instance and breaks zero-downtime deploys). **R2 over S3:** zero-egress + cheaper + S3-compatible (reversible to S3/B2/Wasabi/MinIO); revisit only for EU data-residency.

---

## 8. Deferred (seams kept — do NOT build now)

| Deferred capability | Kept seam |
| --- | --- |
| Google OAuth **web** login (formalize; [#120](https://github.com/solo-ist/prose/issues/120) gates public) | `credentials.type='google'` row |
| AtProto identity + **AtProto publish target** | `credentials.type='atproto'` + a `PublishTarget` interface |
| Nostr (NIP-07) identity + public publishing | `credentials.type='nostr'` + `verifyCredential` dispatch |
| Distributed Press / IPFS / DWeb hosting | `PublishTarget` interface |
| Public/private **managed published pages** (beyond the flat-file share) | the `publications` table + share-serving route |
| Multi-provider / **BYOK** gateway-metering policy ([#683](https://github.com/solo-ist/prose/issues/683)) | the gateway proxy is the single metering point |
| Real-time / **CRDT** comments | the newest-wins sync engine (3b) |
| **Stripe payment collection** | `granted_by='stripe'` + the unwired webhook skeleton |
| Full **cross-surface (all-devices) sync** | the abstract storage interface (§5) |

---

## 9. Open questions

- **BYOK ([#683](https://github.com/solo-ist/prose/issues/683)) vs the meter:** a BYOK key could bypass gateway metering — needs a policy before BYOK ships on web.
- **Snapshot vs live markdown share:** MVP is a **snapshot with manual re-publish**; when (if ever) do we want live updates short of CRDT?
- **Wave-1 headline:** does "Prose anywhere (web)" become the Track C story over reMarkable parity? (Roadmap open question.)

## 10. Verification / QA

- **Web E2E** (`playwright.web.config.ts`, `test:web`): sign-in; gated proxy returns a clean block when un-entitled; share → comment → revoke → 404 on tamper; flat-HTML serve.
- **Desktop** via Circuit Electron: account sign-in (reader-app), share/publish entry points, desktop↔web comment coherence (3b), MAS force-off.
- **Security review** (`/security-review`): capability-token handling, CSRF/origin model, credential storage, MAS anti-steering.
- **Principles check:** markdown stays the source of truth; sharing is explicit/revocable; nothing destroys local content on a blocked/gated call.
