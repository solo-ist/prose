# Gateway staging

A second copy of the gateway on Render, for deploying a gateway change before it reaches production (#1349). Production deploys every `gateway/` commit on `main`; staging deploys whatever is pushed to the `staging` branch.

| | Production | Staging |
|---|---|---|
| Service | `prose-gateway` | `prose-gateway-staging` |
| Database | `prose-gateway-db` | `prose-gateway-staging-db` |
| API host | `api.prose.solo.ist` | `api-staging.prose.solo.ist` |
| Share host | `*.share.prose.solo.ist` | `share-staging.prose.solo.ist` (no per-share subdomains) |
| Deploys from | `main` | `staging` |
| Defined by | created by hand; `gateway/render.yaml` describes it | `gateway/render.staging.yaml`, a synced Blueprint |

Staging shares nothing with production: its own database, auth secret, R2 bucket and mail key. A staging session cookie or share link means nothing to production.

## 1. One-time setup (operator)

These steps create two billable Render resources (a Starter web service and a basic-256mb Postgres).

1. **Create the `staging` branch** from `main`: `git push origin origin/main:refs/heads/staging`.
2. **Create the Blueprint.** Render dashboard → New → Blueprint → the `solo-ist/prose` repo → Blueprint file path `gateway/render.staging.yaml`. Render lists one service and one database to create; it must not list `prose-gateway` or `prose-gateway-db`. Check the file first with `render blueprints validate gateway/render.staging.yaml`.
3. **Move both resources** into the Prose project's **Staging** environment.
4. **Set the secrets** on `prose-gateway-staging` → Environment. The service will not boot until the first four are set (`gateway/src/config.ts`):

   | Variable | Value |
   |---|---|
   | `BETTER_AUTH_SECRET` | a new random secret (`openssl rand -base64 32`), never production's |
   | `ANTHROPIC_API_KEY` | a key with a low spend limit |
   | `RESEND_API_KEY` | a Resend key of its own |
   | `MAIL_FROM` | for example `Prose Staging <signin@prose.solo.ist>` |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | a staging bucket and a token scoped to that bucket only. Unset, artifacts fall back to Postgres, which does not exercise production's storage path |

5. **Add the custom domains** on the service (the Blueprint declares them): `api-staging.prose.solo.ist` and `share-staging.prose.solo.ist`. At Hover, add a CNAME for each pointing at the service's `onrender.com` target. Render issues the certificates once the records resolve.
6. **Check it:** `curl -s https://api-staging.prose.solo.ist/health` returns 200, and the boot log ends with `[gateway] listening`.

## 2. Promoting a change

```sh
git push origin <branch>:staging --force
```

The force is expected: `staging` is a pointer to whatever is under test, not a branch with history of its own. Render deploys the push; follow it with `render deploys list <staging service id>` or in the dashboard.

Reset staging to production's code with `git push origin origin/main:staging --force`.

## 3. What to check

- **The boot log:** migrations applied, `[gateway] listening`, no errors (`render logs --resources <staging service id> --type app`). Read the application log, not the request log: request lines contain share links.
- **Sign-in:** request a code at the staging API host with your own address.
- **The gateway suites** cover behaviour; staging covers what they stub: a real R2 bucket, real mail delivery, Render's proxy in front of the relay socket, and a migration applied to a database that already has rows.

## 4. Limits, today

- **The desktop app cannot point at staging.** `src/main/share/index.ts` accepts only `api.prose.solo.ist` and loopback as a gateway, so publishing a share or dialing the relay from the app against staging needs a change there first (tracked in #1349).
- **The database starts empty** and drifts from production. A migration that passes here has been tested against staging's rows, not production's.
- **Mail is real.** Staging sends through Resend to whatever address is typed. Use your own.

## 5. Resetting the database

Staging data is disposable. To start over, delete `prose-gateway-staging-db` in the dashboard and sync the Blueprint again, which should recreate the database; the next deploy then applies every migration from the first. This path has not been exercised yet: confirm the service's `DATABASE_URL` points at the new database before trusting it.
