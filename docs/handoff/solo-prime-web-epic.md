# Solo Prime Handoff — Web Foundations Epic (Track C, #598)

**Audience:** Solo Prime (autonomous coding agent, Mac Studio).
**Prepared:** 2026-07-04. **Repo:** `solo-ist/prose` (public). **Epic:** [#598](https://github.com/solo-ist/prose/issues/598).
**Canonical design:** `docs/architecture/web-platform.md` (on branch `docs-web-foundations` / PR #773 until merged, then on `main`).

> This runbook is self-contained. It hands you the entire remaining **Web Foundations** epic — building Prose's paid-platform backend (the "gateway") and the web surfaces on top of it. **Start at §4 (the immediate, blocked task), then work §5 phase-by-phase.** Everything you need — state, identifiers, gotchas, guardrails — is here or in the linked GitHub issues (the issues are the source of truth for scope).

---

## 1. What you're building (the thesis)

One epic delivers five fundamentals on top of a single self-hostable backend (the **gateway**): accounts, server-side storage, a **gated** LLM proxy, hash-protected share links, and a thin at-cost paid tier. The renderer *already runs in a browser* (there's a working web build) — the net-new work is the **backend + a share viewer**, not "porting to the browser." Paid lives on the web/account layer, never Apple IAP; the Mac App Store build is a free taste. The gateway stays a portable, self-hostable monolith (co-op ethos).

Read `docs/architecture/web-platform.md` in full before Phase 1 — it is the canonical narrative (architecture, the Account⟂credential model, the share/comment design, the deferred seams). This runbook is the *operational* companion.

## 2. Current state (2026-07-04)

| Item | State |
|---|---|
| **Epic #598** | 12 sub-issues, **2 done** (#601 auth spike, #602 billing spike). |
| **PR #773** (`docs-web-foundations`) | OPEN — lands `web-platform.md` + roadmap reconciliation (Prisma 7 / Render / Hover / storage split). Awaiting CI + `claude[bot]` review. |
| **PR #808** (`spike-775-sse-proof`) | OPEN — lands the #775 SSE-through-Hono proof + decision note. `Closes #775`. |
| **PR #809 (DRAFT)** (`issue-765-gateway-scaffold`) | The **Phase 0 gateway**, `Closes #765`. Code-complete + verified locally. **Flip to ready once the deploy validates (§4).** This is the branch you work on for Phase 0. |
| **Gateway (Phase 0 code)** | Built + locally green (health/401/magic-link/403/seed/live-SSE, `tsc` clean). |
| **Render deploy** | **CRASH-LOOPING** — blocked on env vars (see §4). This is your first task. |

**Spikes resolved:** #601 → Better Auth (self-hostable, magic-link). #602 → at-cost plan + entitlements + `granted_by` seam. #775 → SSE-through-Hono confirmed (15/15). **Still open:** #776 (comment-sync *design* spike — a design artifact that gates Phase 3b/#769; do it before #769, not before #768).

## 3. Prerequisites — provision these on the Mac Studio (some are human-only)

**Agent-usable (Solo Prime):**
- `git` + clone `https://github.com/solo-ist/prose` (public). Check out **`issue-765-gateway-scaffold`** to continue Phase 0.
- **Node ≥ 22**, **Docker** (local Postgres for gateway dev), **`gh` CLI** authenticated with write to `solo-ist/prose`.
- **Render CLI** (`render` v2.21+, `render login`, `render workspace set tea-d929gl19rddc7389iqj0`). ⚠️ **The CLI cannot *update* env vars — only set them at `create`, and that is unreliable** (see §4/§6). Use the **Render dashboard** or the **REST API** (needs a Render API key) for env vars.
- An **`ANTHROPIC_API_KEY`** for the gateway's operator-side proxy (set as a Render env var, never in the repo).

**Human-gated (flag to Angel; do not attempt autonomously):**
- **Hover DNS** changes (the `api.prose.solo.ist` CNAME).
- **Render billing / plan** changes; **App Store** anything.
- **Provisioning secrets** (Anthropic key, Render API key) onto the machine.
- **Merging to `main`** — see the working agreement (§6): open PRs, wait for green CI + `claude[bot]` review; a human approves the merge (especially security-gated PRs).

**Never** put secrets in the repo. `gateway/.env` is gitignored; production secrets live in Render env vars.

---

## 4. ▶ IMMEDIATE TASK — finish the Phase 0 deploy (#765)

**Branch:** `issue-765-gateway-scaffold` (PR #809, draft). The gateway is built; the deploy just needs env vars, then validation.

### 4a. The blocker
The Render deploy builds cleanly but crash-loops on start: `prisma migrate deploy` → *"The datasource.url property is required"* because **`DATABASE_URL` is not attached to the service**. Root cause: the Render CLI's create-time `--env-var` silently dropped them, and there's no CLI command to update env vars. The code is already correct (`prisma.config.ts` reads `process.env.DATABASE_URL`; the server binds Render's `PORT`) — the fix is purely attaching the env vars.

### 4b. Render resources (already created)
| Resource | ID / value |
|---|---|
| Workspace | `tea-d929gl19rddc7389iqj0` |
| Web service | `srv-d92aeoojs32c738hi0e0` → **https://prose-gateway.onrender.com** (Starter, Virginia, Docker, branch `issue-765-gateway-scaffold`, root `gateway`) |
| Postgres | `dpg-d92adne7r5hc73fa94e0-a` (`prose-gateway-db`, basic_256mb, PG16, Virginia) |
| Dashboard (env) | https://dashboard.render.com/web/srv-d92aeoojs32c738hi0e0/env |

### 4c. Set the env vars (dashboard = reliable path)
Add these to the service, then **Save** (auto-redeploys):
| Env var | Value |
|---|---|
| `DATABASE_URL` | **"Add from Database" → `prose-gateway-db`** (links the internal connection string; never exposes the password). ← the missing one |
| `ANTHROPIC_API_KEY` | the operator Anthropic key |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` output (or dashboard "Generate") |
| `BETTER_AUTH_URL` | `https://prose-gateway.onrender.com` (switch to `https://api.prose.solo.ist` after the domain is live) |
| `NODE_ENV` | `production` |

`CORS_ORIGINS` can be omitted — the code defaults to `prose.solo.ist` + localhost.

*(Alternative to the dashboard: the Render REST API `PUT /v1/services/{id}/env-vars` with a Render API key — fully scriptable, but the key is a human-provisioned secret.)*

### 4d. Validate (the A.5 go/no-go — no UI needed)
Poll the deploy (`render deploys list srv-d92aeoojs32c738hi0e0 -o json` → status `live`), then against `https://prose-gateway.onrender.com`:
1. `GET /health` → `{"ok":true,"dbStatus":"connected"}` — **this proves Prisma 7 migrate-deploy applied over Render Postgres** (the second make-or-break).
2. `POST /api/llm/stream` unauthenticated → **401**.
3. `POST /api/auth/sign-in/magic-link` `{email, callbackURL:"/health"}` (header `Origin: https://prose-gateway.onrender.com`) → link printed to the service logs (`render logs -r srv-... `); complete it → session cookie.
4. Authed but un-entitled `POST /api/llm/stream` → **403** `forbidden/ai_proxy`.
5. Seed the grant, then authed+entitled → **live SSE stream** via `curl --no-buffer`. **Confirm the tokens arrive incrementally (no buffering)** and the response carries `x-accel-buffering: no` — this is the #1 Render make-or-break (Render buffers SSE by default; the code already sets the header). Confirm a **>60s** stream isn't cut and a client disconnect aborts upstream.

Seed script (run once the user exists, i.e. after step 3): `npm run seed:ai-proxy -- --email <you>` — but that runs against the DB; on Render use `render psql dpg-...` or a one-off job, or add the row via the entitlements API once #770 exists. For Phase 0, the simplest is a one-off: connect with `render psql dpg-d92adne7r5hc73fa94e0-a` and `INSERT INTO entitlements (id, "userId", feature, "grantedBy", "grantedAt") VALUES (gen_random_uuid(), '<user id>', 'ai_proxy', 'manual', now());`.

**Go/no-go:** all pass → Render is validated; proceed. SSE buffered/cut, or Prisma/SSL fails → **stop and surface to Angel**; the fallback host is a **self-managed VPS (Hetzner/DO)**, NOT Fly (the Docker image is portable). Record the outcome as a decision note in `web-platform.md` (same pattern as the #775 note).

### 4e. Custom domain + finish
- In Render, add custom domain **`api.prose.solo.ist`** to the service → Render returns a CNAME target. **Ask Angel** to add the CNAME at **Hover** (`api` → the Render target). Render manages TLS (Let's Encrypt); no CDN/proxy in front.
- Once it resolves, set `BETTER_AUTH_URL=https://api.prose.solo.ist` (dashboard) and add `https://prose.solo.ist` to `CORS_ORIGINS` if not already covered.
- Seed Angel's `ai_proxy` grant; confirm a real end-to-end stream.
- **Flip PR #809 to ready-for-review**, check its two boxes, wait for green CI + `claude[bot]` review, then human-gated merge.

---

## 5. The remaining epic — Phases 1→4 (#766–#771)

Do these **after** Phase 0 merges. **One PR per issue**, branch `issue-<n>-<slug>` off fresh `main`, reference the issue, wait for CI + review. The GitHub issue body is the authoritative scope for each; summaries below. Critical path: **#765 → #766 → #767 → #768 → #769**, with **#770 parallel off #766** and **#771 cross-cutting**. **#776's design artifact gates #769.**

### Phase 1 — [#766](https://github.com/solo-ist/prose/issues/766) Accounts + gated LLM proxy + web client *(after #765)*
- `account:*` IPC namespace (`src/main/ipc.ts`) + preload wrappers + `ElectronAPI` signatures (`src/renderer/types/index.ts`). Store the gateway session token via `credentialStore` (safeStorage), new key.
- Rewrite web `llmChatStream()` (`src/renderer/lib/browserApi.ts`) to `POST /api/llm/stream`, **keeping the existing `llm:stream:*` window-event protocol so `useChat` is unchanged** (this seam is load-bearing — do not break it).
- Enforce the `ai_proxy` **gate** on the gateway (minimal allowlist; generalized by #770). **Never an ungated proxy on the operator's key.** `llm_usage` = write-only meter, not the gate.
- Web router + gateway client behind `getApi()`. New `webPlatform` feature flag (mirror `googleDocs` opt-in in `src/renderer/lib/featureFlags.ts`).
- **Accept:** logged-in entitled web user gets a real streamed response; un-entitled cleanly blocked; desktop BYOK path unchanged (still direct Anthropic in main).

### Phase 2 — [#767](https://github.com/solo-ist/prose/issues/767) Server-side document storage *(after #766)*
- `documents` table (markdown **text lives in Postgres, never object storage**). `serverApi.ts` over an **abstract storage interface**; swap the web mock. R2 remains blobs-only (images/attachments/snapshots), still stubbed until a blob feature needs it.

### Phase 3a — [#768](https://github.com/solo-ist/prose/issues/768) Share links + viewer + one-way comments *(after #767; coordinates #699)*
- `publications` + **hashed capability token** (`GET /s/:token`): `html_share` → serve stored flat HTML (reuse `lib/htmlExport.ts` `buildProseHtml()`); `markdown_share` → the share SPA.
- New **sibling mount** `src/renderer/share-main.tsx` + `share-index.html` (2nd Rollup input) + `components/share/*` — read-mostly TipTap (Editor extensions minus AISuggestion/AIAnnotations/NodeIds; **keep the Comment mark**), network-backed comment store.
- Commenter identity: no account; display name + optional notification email + a very-unpushy account nudge. Harden `/s/*` (Referrer-Policy no-referrer, rate-limit, revocation, optional expiry).

### Phase 3b — [#769](https://github.com/solo-ist/prose/issues/769) Bidirectional comment sync *(after #768; consumes #776; reuses Activity projection)*
- **Do the [#776](https://github.com/solo-ist/prose/issues/776) design spike first** — the artifact defines the schema, sync-metadata shape, conflict + anchor rules. Model on `src/main/google/sync.ts`: stable comment IDs, per-doc sync-metadata, **timestamp newest-wins, no CRDT**. Re-anchor on re-publish by `markedText` (+ `occurrenceIndex`); anchors that don't match are **flagged "anchor lost" and KEPT**. **Resolving preserves the thread as Activity history** (extend the `AIEditsHistoryPanel` projection of `useAnnotationStore`) — never deletes (today `unsetComment` deletes). Reconcile with #699's threading model, not a parallel schema.

### Phase 4 — [#770](https://github.com/solo-ist/prose/issues/770) Entitlements + thin at-cost paid tier *(parallel off #766; resolves #602)*
- `entitlements` table + gateway middleware (generalizes Phase 1's allowlist). **Manual/beta-invite grants**; `granted_by` seam + an **unwired Stripe skeleton** (no payment collection yet). `sessions` for revocation.

### Cross-cutting — [#771](https://github.com/solo-ist/prose/issues/771) MAS seams + `webPlatform` flag
- Gate **every** web-platform desktop surface behind the `webPlatform` flag **AND** `IS_MAS_BUILD` (force-off on MAS, exactly like reMarkable). Desktop sign-in = Apple **reader-app pattern** (no IAP, no purchase/upsell UI — anti-steering). Credentials via `safeStorage` only. No MAS hardening now; just keep the seams correct.

### Also in the epic
- [#364](https://github.com/solo-ist/prose/issues/364) prose.solo.ist marketing shell (shares the domain host — coordinate at deploy). [#439](https://github.com/solo-ist/prose/issues/439) hosted-OCR (deferred Wave-2 child; depends on the platform being live).

---

## 6. Working agreement / guardrails (read before you touch code)

- **One issue → one branch (`issue-<n>-<slug>`) → one PR.** Reference the issue; use `Closes #<n>` in the body. Branch off freshly-fetched `origin/main`.
- **Wait for green CI + the `claude[bot]` review before proposing merge.** Do not skip the wait. Merges to `main` are **human-gated** (especially any PR touching privilege-boundary files — CI/build config — which the pipeline marks `security-gate`).
- **Use `gh` for all GitHub ops.** Board (#5) hygiene: only move items between existing columns; **never mutate field definitions**; archive closed items (`gh project item-archive`).
- **Security (hard rules):** every filesystem IPC handler calls `validatePath()`; API keys/tokens via `credentialStore` (safeStorage) only, never plaintext; **no `innerHTML` with dynamic/LLM/shared content**; never change `contextIsolation`/`nodeIntegration`/`sandbox`; `shell.openExternal` only `http(s)`; MCP CORS reflects localhost only.
- **AI-gating invariant:** any UI/background path that triggers an LLM call gates on `isAIConfigured()`/`aiAvailability()` (`lib/llm.ts`); never destroy user content (comments, suggestions) on a blocked/gated call.
- **The gateway proxy is GATED from day one** (`ai_proxy` entitlement) — never an open proxy on the operator's key. `llm_usage` is a write-only meter, not the gate.
- **Verify on real infra**, not just green CI. Prefer local HITL/e2e where the behavior isn't covered by tests. Flag human-gated steps (DNS, billing, secrets, App Store) — don't attempt them.
- **Keep the renderer seam intact:** `getApi()` and the `llm:stream:*` window events are the contract between `browserApi.ts` and `useChat` — later phases plug into it without changing `useChat`.

## 7. Gotchas already paid for (don't rediscover these)

- **Prisma 7** ≠ Prisma 6. The datasource URL is **not** in `schema.prisma`; it lives in `prisma.config.ts`. Connections go through a **driver adapter** (`@prisma/adapter-pg` + `pg`). Read **`process.env.DATABASE_URL`** directly (not Prisma's `env()` helper) so platform-injected vars resolve at runtime. Client generates to `gateway/src/generated/prisma` (gitignored; run `prisma generate`).
- **Render buffers `text/event-stream` by default** → the stream route sets **`X-Accel-Buffering: no`** (+ `no-cache`, `keep-alive`). Render allows 100-min responses (long streams aren't cut); tune Node `keepAliveTimeout`/`headersTimeout` (already done).
- **The Render CLI cannot update env vars** — only set at `services create`, and that dropped them. Use the dashboard or REST API. Bind Render's injected **`PORT`** (not a hardcoded port).
- **Render free Postgres expires in 30 days, no backups** — use paid Basic-256MB (already provisioned).
- **`services get -o json` does not return env var values** — absence there ≠ unset; verify via a redeploy's migrate step or `render psql`.

## 8. Appendix — identifiers & links

- **Epic:** #598 · **Phases:** #765 (deploy, in progress) · #766 · #767 · #768 · #769 · #770 · #771 · **design spike** #776 · marketing #364 · deferred #439.
- **PRs:** #773 (docs) · #808 (SSE proof) · #809 (gateway, draft).
- **Branch to continue Phase 0:** `issue-765-gateway-scaffold` (HEAD `6408cbf`).
- **Render:** workspace `tea-d929gl19rddc7389iqj0` · service `srv-d92aeoojs32c738hi0e0` (https://prose-gateway.onrender.com) · Postgres `dpg-d92adne7r5hc73fa94e0-a`.
- **Target domain:** `api.prose.solo.ist` (Hover CNAME → Render target).
- **Gateway layout:** `gateway/` — `src/{index,app,config}.ts`, `routes/{health,llm/stream}.ts`, `middleware/{cors,session,entitlement}.ts`, `auth/`, `db/`, `entitlements/`, `r2/` (stub); `prisma/schema.prisma` + `prisma.config.ts`; `scripts/{mock-upstream,test-gateway,seed-ai-proxy}`; `Dockerfile`, `render.yaml`, `docker-compose.yml`, `README.md`.
- **Local dev:** `cd gateway && cp .env.example .env` (set `BETTER_AUTH_SECRET`) → `npm install` → `npm run dev:db` → `npm run db:migrate:dev` → `npm run dev`; `npm run mock` for a keyless SSE upstream. Full recipe in `gateway/README.md`.
