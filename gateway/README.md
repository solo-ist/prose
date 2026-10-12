# Prose Gateway

The self-hostable backend for Prose's **Web Foundations** epic (Track C / Paid
Platform Foundation, [#598](https://github.com/solo-ist/prose/issues/598)). This is
**Phase 0** ([#765](https://github.com/solo-ist/prose/issues/765)) — the gateway
scaffold: accounts + a gated LLM proxy. Server-side documents, share links, and
comment sync land in later phases.

Canonical design: [`../docs/architecture/web-platform.md`](../docs/architecture/web-platform.md).

## Stack

- **Hono** + `@hono/node-server` — HTTP + SSE streaming
- **Prisma 7** — Postgres via the `@prisma/adapter-pg` driver adapter (WASM query
  compiler; the connection URL lives in `prisma.config.ts`, not `schema.prisma`)
- **Better Auth** — emailed 6-digit sign-in codes (emailOTP) + sessions, via its Prisma adapter (the
  resolved [#601](https://github.com/solo-ist/prose/issues/601) auth pick)
- **Cloudflare R2** (`@aws-sdk/client-s3`) — binary blobs only; **stubbed** in Phase 0

Standalone package: its own `package.json` / `tsconfig.json` — the root Electron app
never bundles it.

## Local development

Prereqs: **Node ≥ 22** and **Docker** (for local Postgres).

```bash
cp .env.example .env          # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
npm install
npm run dev:db                # docker Postgres on :5433
npm run db:migrate:dev        # apply migrations + generate the Prisma client
npm run dev                   # gateway on :4000 (tsx watch)
```

To exercise the LLM proxy without a real key, run the mock upstream and point the
gateway at it (`UPSTREAM_URL=http://localhost:4001` is already in `.env.example`):

```bash
npm run mock                  # Anthropic-shaped SSE mock on :4001
```

With a real key, set `ANTHROPIC_API_KEY` and leave `UPSTREAM_URL` unset.

## The `ai_proxy` gate

`POST /api/llm/stream` is gated by `requireSession` → `requireEntitlement('ai_proxy')`,
enforced **before** any upstream Anthropic connection opens (never an ungated proxy on
the operator's key). Grant by email, before or after the account exists (#965):

```bash
npm run grant -- --email you@example.com --feature ai_proxy --by manual
npm run grant -- --email you@example.com --feature ai_proxy --revoke
npm run grant -- --list
```

An unknown email gets an `entitlement_invites` row that is claimed into an
`entitlements` row the first time that person hits the gate
(`src/entitlements/index.ts`). `--by` is `beta`, `comp` or `manual`;
`opencollective` rows are reserved for the #953 reconcile and never touched.

## Verification (no UI)

```bash
curl :4000/health                                   # {"ok":true,"service":"prose-gateway"}
curl -X POST :4000/api/llm/stream -d '{}'           # 401 (unauthenticated)
# request a sign-in code, then exchange it for a session cookie:
curl -X POST :4000/api/sign-in/code -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:4000' -d '{"email":"you@example.com"}'
#   → without RESEND_API_KEY the code is printed to the gateway log (dev only)
curl -c cookies.txt -X POST :4000/api/auth/sign-in/email-otp -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:4000' -d '{"email":"you@example.com","otp":"123456"}'
curl -b cookies.txt -X POST :4000/api/llm/stream -d '{}' # 403 forbidden/ai_proxy until granted
# grant → then the same request streams SSE (message_start → deltas → message_stop),
# with `x-accel-buffering: no` on the response.
```

## Deploy

**Render** web service (Docker) + Render managed Postgres; **DNS on Hover**
(`api.prose.solo.ist` CNAME → the Render target, Render-managed TLS; no CDN/proxy).
Validated in the Stage A.5 go/no-go gate before lock-in — see `web-platform.md` §7.
Secrets (`ANTHROPIC_API_KEY`, `BETTER_AUTH_SECRET`, `DATABASE_URL`) come from Render
env vars, never the repo. Migrations run via `prisma migrate deploy` in the start
command before the server serves.

## Share service (#768)

The embedded-artifact share layer (design: `docs/architecture/web-platform.md`
§4.3–4.5). Author routes under `/api/share/*` (session + `share_publish`
entitlement; grant via `npm run grant -- --email you@x --feature
share_publish --by manual`): `POST /publish`, `PUT /:pubId/publish` (re-publish, same
token), `GET /` (list), `GET /:pubId/comments?since=ISO` (cursor pull —
`authorEmail` is never exposed), `DELETE /:pubId` (revoke → 410 + comments
deleted). Public surface under `/s/*` (per-IP rate-limited): `GET /s/:token`
serves the artifact (no-store, no-referrer, strict CSP), `POST
/s/:token/comments` + `POST /s/:token/comments/:id/replies` take anonymous
reviewer comments (~10 writes/min/IP). The raw capability token exists only in
the share URL; rows store its SHA-256. Artifacts go to R2 when configured,
else the `artifactHtml` column (`storage` records which — provisioning R2
later strands nothing).

Integration test (self-contained — boots its own gateway on :4010, harvests
the sign-in code from stdout): `npm run test:share` (needs `npm run dev:db`).
CI runs it on every PR touching `gateway/**` (`.github/workflows/gateway.yml`,
against a Postgres service), after a typecheck and `prisma migrate deploy`.

## Sign-in codes by email (#964, #813)

Sign-in is a 6-digit code delivered by email via **Resend** in production.
In development (no `RESEND_API_KEY`) the code is logged to stdout instead
(the test harnesses read it from there).

**How it works:**
- `POST /api/sign-in/code {email}` (`src/auth/code.ts`) mints a code with
  Better Auth's emailOTP plugin and mails it. A mail failure returns 502
  `mail_failed` rather than a false "check your email".
- `POST /api/auth/sign-in/email-otp {email, otp}` (Better Auth) verifies it,
  creates the account on first sign-in, and sets the session cookie.
- Codes last 10 minutes, are stored hashed, work once, and burn after 5 wrong
  tries; a newer code replaces an older one.
- Limits: 5 codes per address per hour, plus per-IP caps on both routes
  (`SIGN_IN_CODE_IP_MAX`, `SIGN_IN_VERIFY_IP_MAX`, per 10 minutes). Better
  Auth's own limiter is off because it can't see client IPs behind Render.
- With the desktop's per-request `state` nonce, the email also has an
  **Open in Prose** link to `GET /auth/code#c=<code>&s=<state>`. The page
  (hashed-script CSP) shows the code and opens `prose-signin://auth?code=…&state=…`
  (a scheme only the GitHub desktop build claims, #970);
  the desktop accepts it only while a sign-in with that state is pending
  (`src/main/share/deepLink.ts`). The fragment keeps both values out of
  server logs and link-scanner fetches.
- Every other emailOTP route is disabled (404), including
  `check-verification-otp`, which would reveal whether an account exists.

**Setup:**
1. Add `RESEND_API_KEY`, `MAIL_FROM` to the Render env (secrets).
2. Verify the sender domain in the Resend dashboard (SPF + DKIM).
3. Deploy; test with a real email address.

Email integration test: `npm run test:mail` (boots a mock Resend server,
needs `npm run dev:db`).

**Templates (#966).** Every email renders through one branded card in
`src/mail/templates/layout.ts`: table layout, inline styles, light with a
`prefers-color-scheme` dark block, and a plain-text alternative. It's ported
from the Prose design system's `emails/sign-in-code.html`. Each email is a
small function returning `{ subject, html, text }`, e.g.
`templates/signInCode.ts`. `npm run mail:preview` renders them with sample
data to `.mail-preview/` (gitignored) for a browser check. Send a live test
to Gmail, Apple Mail and Outlook before switching a new template on.

## Scope

**In (Phase 0):** gateway scaffold, accounts (magic-link), the gated LLM proxy, the
`entitlements` gate, R2 stub, deploy.
**In (#768 share service):** publish/serve/revoke + anonymous reviewer comments
(see above).
**Out (later phases):** document storage (#767), bidirectional comment sync into
the editor (#769), web-client wiring (#766), the `llm_usage` meter (#954/#848) + Open Collective-backed
entitlements (#953 under #770, replacing the Stripe seam), MAS seams + `webPlatform` flag (#771).
