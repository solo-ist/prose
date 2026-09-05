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
- **Better Auth** — email magic-link + sessions, via its Prisma adapter (the
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
the operator's key). Grant a user after their first sign-in:

```bash
npm run seed:ai-proxy -- --email you@example.com
```

## Verification (no UI)

```bash
curl :4000/health                                   # {"ok":true,"service":"prose-gateway"}
curl -X POST :4000/api/llm/stream -d '{}'           # 401 (unauthenticated)
# request a magic link, then complete it to get a session cookie:
curl -X POST :4000/api/auth/sign-in/magic-link -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:4000' -d '{"email":"you@example.com","callbackURL":"/health"}'
#   → the link is printed to the gateway log (dev only; Phase 0 has no email provider)
curl -b cookies.txt -X POST :4000/api/llm/stream -d '{}' # 403 forbidden/ai_proxy until seeded
# seed → then the same request streams SSE (message_start → deltas → message_stop),
# with `x-accel-buffering: no` on the response.
```

## Deploy

**Render** web service (Docker) + Render managed Postgres; **DNS on Hover**
(`api.prose.solo.ist` CNAME → the Render target, Render-managed TLS; no CDN/proxy).
Validated in the Stage A.5 go/no-go gate before lock-in — see `web-platform.md` §7.
Secrets (`ANTHROPIC_API_KEY`, `BETTER_AUTH_SECRET`, `DATABASE_URL`) come from Render
env vars, never the repo. Migrations run via `prisma migrate deploy` in the start
command before the server serves.

## Scope

**In (Phase 0):** gateway scaffold, accounts (magic-link), the gated LLM proxy, the
`entitlements` gate, R2 stub, deploy.
**Out (later phases):** document storage (#767), share links (#768), comment sync
(#769), web-client wiring (#766), the `llm_usage` meter + Stripe seam (#770), MAS
seams + `webPlatform` flag (#771).
