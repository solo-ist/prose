# Invite-Only Share Beta — Operator Runbook

**Applies to:** `web-foundations` branch, post-merge of PRs #934 (Resend email), #937 (one link per doc), #938 (per-pub subdomains).
**Owner:** Angel · **Audience:** operator (you, running the Render service)

---

## 1. What the beta is

The share service lets a desktop Prose user publish a document as a self-contained HTML artifact at `https://<label>.share.prose.solo.ist/s/<token>`. Invited reviewers open the link in any browser — no account, no install.

Key constraints for the beta:

- **Invite-only.** Publishing requires the `share_publish` entitlement, hand-granted by the operator after each invitee signs in for the first time.
- **Desktop only.** The share surface lives behind the `webPlatform` feature flag, which is off by default. Invitees must enable it manually (see §3).
- **MAS excluded.** `webPlatform` is force-off in Mac App Store builds regardless of settings.
- **Reviewers need nothing.** Anyone with the link can read the artifact and leave comments. No account, no flag.

---

## 2. Prerequisites — Render environment checklist

All values below must be set in the Render dashboard under **prose-gateway → Environment** before the service starts in production. None belong in the repo.

| Env var | Purpose | Notes |
|---|---|---|
| `NODE_ENV` | Sets production-mode validation | `production` — already in `render.yaml` |
| `GATEWAY_PORT` | Port the server binds to | `4000` — already in `render.yaml` |
| `BETTER_AUTH_URL` | Canonical auth origin; sets the cookie `Secure` flag | `https://api.prose.solo.ist` — already in `render.yaml` |
| `CORS_ORIGINS` | Origins allowed to call `/api/*` | `https://prose.solo.ist` — already in `render.yaml` |
| `DATABASE_URL` | Postgres connection string | Injected by Render from the managed Postgres service |
| `BETTER_AUTH_SECRET` | Signs session tokens; must be 32+ random bytes | Generate: `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | The gateway's Anthropic key for the LLM proxy | Required even if the proxy is unused during the beta |
| `SHARE_BASE_URL` | The dedicated share origin (origin isolation, #902) | `https://share.prose.solo.ist` — **must differ from `BETTER_AUTH_URL`** |
| `RESEND_API_KEY` | Delivers magic-link emails via Resend | Obtain from resend.com; sender domain must be verified (SPF + DKIM) |
| `MAIL_FROM` | The `From` address on outbound emails | Must be on a Resend-verified domain, e.g. `prose@prose.solo.ist` |
| `R2_ACCOUNT_ID` | Cloudflare account ID for artifact storage | Required for `storage: 'r2'` |
| `R2_ACCESS_KEY_ID` | R2 API token key ID | Required for R2 |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret | Required for R2 |
| `R2_BUCKET` | R2 bucket name for artifacts | Required for R2 |
| `SHARE_SUBDOMAINS` | Enables per-publication subdomain routing (#938) | Set to `1` **only after** the wildcard `*.share.prose.solo.ist` DNS and TLS are live on Render — see the deploy order in §5 |

> **Removed in #934:** `AUTH_MAGIC_LINK_STDOUT` is no longer read. Delete it from the Render env if it was set.

The gateway validates all required vars at boot and exits non-zero with a clear error message if any are missing.

---

## 3. Granting an invitee

### What you do (operator)

1. Confirm the Render service is healthy: `curl https://api.prose.solo.ist/health` should return `{"ok":true,"service":"prose-gateway"}`.
2. Send the invitee their invitation (see §6 for suggested copy).

### What the invitee does

1. **Enable the feature flag and point at the prod gateway.** Quit Prose, open `~/Library/Application Support/Prose/settings.json` in a text editor, and add (or merge into the existing top-level keys):
   ```json
   "featureFlags": { "webPlatform": true },
   "webPlatform": { "gatewayUrl": "https://api.prose.solo.ist" }
   ```
   Save the file, then relaunch Prose.

   **Both keys are required.** The built-in default gateway (`DEFAULT_GATEWAY_URL` in `src/main/share/index.ts`) is still the raw `prose-gateway.onrender.com` host. Magic links are minted on `BETTER_AUTH_URL` (`api.prose.solo.ist`), and the desktop's same-gateway check rejects a link from a different origin, so sign-in fails without the override. #943 fixes the default before GA.

2. **Sign in.** Open any document. A share icon (◎) appears in the top-right corner. Click it and enter the email address you agreed on. Prose sends a magic-link request to the gateway, which emails the link via Resend.

3. **Complete sign-in.** Open the email, click the link, and paste the resulting URL (from the `/auth/link` landing page) into the Prose sign-in dialog.

4. **Publish.** After sign-in succeeds, click **Publish** in the share popover. The first publish will return a 403 until you grant the entitlement (next step).

### What you do (grant the entitlement)

Once the invitee has signed in at least once, open a **Render Shell** on the `prose-gateway` service and run:

```bash
npm run seed:ai-proxy -- --email invitee@example.com --feature share_publish
```

The script is idempotent — safe to re-run. Confirm output:
```
✓ Granted "share_publish" to invitee@example.com (user <id>).
```

The invitee can now click **Publish** without a 403. Their first publish produces a URL at `https://<label>.share.prose.solo.ist/s/<token>` (or `https://share.prose.solo.ist/s/<token>` if `SHARE_SUBDOMAINS` is not yet set).

---

## 4. Revoking access and taking down publications

### Revoking an invitee's publish entitlement

**There is no `--revoke` flag in the seed script.** This is a gap. Until a revoke command exists, remove the entitlement directly via the Render Shell:

```bash
# Render Shell, from the gateway directory:
echo "DELETE FROM entitlements
WHERE \"userId\" = (SELECT id FROM \"user\" WHERE email = 'invitee@example.com')
  AND feature = 'share_publish';" | npx prisma db execute --stdin
```

(Or run the same SQL with `psql "$DATABASE_URL"` if you connect directly.) Tracked in #942.

After removal the invitee's next publish attempt returns 403. Existing published links remain live — revoke individual publications separately (below).

### Author-side publication takedown

The invitee can revoke any of their own publications from the Prose desktop app: open the share popover (◎) and click **Revoke**. The gateway sets `revokedAt`, deletes the R2 object, and serves `410 Gone` with a styled takedown page to anyone who opens the old link.

### Operator-side publication takedown

**There is no operator takedown endpoint** (a gap, tracked in #942). Until one exists, mirror what the author revoke does (`DELETE /api/share/:pubId` in `gateway/src/routes/share/author.ts`): tombstone the publication and delete its comments in one transaction, then drop the artifact.

1. **Find the publication.** The database stores `tokenHash`, not the raw token, so hash the `<token>` from the `/s/<token>` URL:
   ```bash
   echo -n "<token>" | openssl dgst -sha256 -hex
   ```
   Look it up with `SELECT id, title, storage, "r2Key", "revokedAt" FROM publications WHERE "tokenHash" = '<hash>';`. `prisma db execute` only reports success or failure and never prints rows, so run SELECTs in `psql`. Use the PSQL command from the Render dashboard's Postgres **Connect** menu.
2. **Tombstone it and delete its comments** (from the gateway directory in the Render Shell). Every `/s/` route returns 410 once `revokedAt` is set:
   ```bash
   echo "BEGIN;
   DELETE FROM share_comments WHERE \"publicationId\" = '<publication-uuid>';
   UPDATE publications SET \"revokedAt\" = NOW(), \"artifactHtml\" = NULL WHERE id = '<publication-uuid>';
   COMMIT;" | npx prisma db execute --stdin
   ```
3. **If `storage` was `r2`,** delete the object `shares/<publication-uuid>/artifact.html` from the bucket in the Cloudflare R2 dashboard.

---

## 5. Pre-open checks on prod

Run these before inviting anyone.

### Wildcard DNS + subdomains

If `SHARE_SUBDOMAINS=1` will be set, the wildcard must be live first. Deploy order (#938):

1. Add wildcard custom domain `*.share.prose.solo.ist` on the Render service.
2. Add Hover DNS CNAMEs: `*.share` → Render target, `_acme-challenge.share` → Render TLS challenge, `_cf-custom-hostname.share` → Render hostname verification.
3. Wait for Render to provision the wildcard TLS cert and show it as verified.
4. Set `SHARE_SUBDOMAINS=1` in Render env and redeploy.

**Do not set `SHARE_SUBDOMAINS=1` before the wildcard TLS is live** — the first page load from a label host will return a TLS error before Render answers.

### CORS origin check

Confirm `CORS_ORIGINS` is exactly `https://prose.solo.ist` (no trailing slash, no extra origins). A test from an arbitrary localhost origin should be refused:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Origin: http://localhost:9999" \
  https://api.prose.solo.ist/health
```

Expect `200` for the body, but the response must **not** carry `Access-Control-Allow-Origin: http://localhost:9999`. Check with `-v`.

### Email sign-in (no links in logs)

After #934 merges, `AUTH_MAGIC_LINK_STDOUT` is gone. Magic-link URLs must travel by email only — they must **not** appear in Render logs. Verify:

1. Request a magic link for your own email via Prose desktop sign-in.
2. Open Render → Logs. Confirm no `https://api.prose.solo.ist/api/auth/verify-magic-link?...` line appears.
3. Confirm the email arrives in your inbox.

### Publish + subdomain URL

After granting yourself `share_publish`:

1. Publish a test document from Prose.
2. Confirm the share URL is in the form `https://<label>.share.prose.solo.ist/s/<token>` (with `SHARE_SUBDOMAINS=1`) or `https://share.prose.solo.ist/s/<token>` (without).
3. Open the URL in a browser. The artifact should load; the share icon should appear.

### Bare-host 308 redirect

With `SHARE_SUBDOMAINS=1`, a direct GET to the bare share host should 308 to the label host:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "https://share.prose.solo.ist/s/<token>"
```

Expect `308`.

### Origin isolation spot-check

Open two different publications — `<label-A>.share.prose.solo.ist/s/<token-A>` and `<label-B>.share.prose.solo.ist/s/<token-B>` — in the same browser. In publication B's DevTools console:

```js
Object.keys(localStorage).filter(k => k.startsWith('prose-edit-tokens'))
```

This must return an empty array. B's origin cannot read A's localStorage.

### Storage field

After publishing, confirm the publication row has `storage = 'r2'` (not `'db'`) by querying in `psql` (see §4 for how to connect):
```sql
SELECT storage, "r2Key" FROM publications ORDER BY "publishedAt" DESC LIMIT 5;
```

If R2 env vars are set correctly, all new rows should show `storage = 'r2'`.

### Revoke → 410

Revoke a test publication from Prose desktop. Open the old link. Expect the styled 410 takedown page ("This link was taken down by its author.").

---

## 6. What invitees should expect

Use this section as a draft for your invite email.

---

Hi — you're one of the first people to try Prose's new sharing feature. Here's what it does and what to expect.

**What it is:** You can publish any document in Prose as a shareable link. Recipients open it in a browser — no install, no account. They can read and leave comments, which sync back to your Prose app.

**Setup (one time):**
1. Quit Prose, open `~/Library/Application Support/Prose/settings.json`, and add these two top-level entries (keep the commas valid):
   `"featureFlags": { "webPlatform": true },`
   `"webPlatform": { "gatewayUrl": "https://api.prose.solo.ist" }`
   Then relaunch Prose.
2. Click the ◎ icon in the top-right corner of any document, enter your email, and follow the sign-in link. Once signed in, you'll see a **Publish** button.

**What works:**
- Publish and share a link to any document.
- Reviewers can comment on highlighted text. Comments sync to your app.
- Re-publishing updates the link in place — the URL stays the same.
- Revoking a link takes it down immediately and deletes its comments on the server (anyone who opens it sees a "taken down" page; copies people already downloaded stay readable).

**Known limits:**
- Desktop only — the feature isn't available in the App Store version.
- Publishing requires you to be signed in; reviewers need no account.
- This is an early beta: expect rough edges. Some things (like conflict resolution for simultaneous edits) aren't built yet.

**Reporting issues:** just reply to this email, or open an issue at github.com/solo-ist/prose.

---

## 7. Troubleshooting

### Sign-in link not arriving

- Check Render logs for any `[mail]` error lines — a non-2xx from Resend will log `sendMail failed`.
- Confirm `RESEND_API_KEY` is set and the sender domain is verified in the Resend dashboard (SPF + DKIM). Unverified domains fail silently or bounce.
- Check spam. The `From` address is whatever `MAIL_FROM` is set to.
- In the Render Shell, you can send a test request directly:
  ```bash
  curl -X POST https://api.prose.solo.ist/api/auth/sign-in/magic-link \
    -H 'Content-Type: application/json' \
    -H 'Origin: https://prose.solo.ist' \
    -d '{"email":"you@example.com","callbackURL":"/health"}'
  ```
  Check Render logs for the result.

### 403 on publish — entitlement not granted

The invitee signed in but the `share_publish` entitlement hasn't been seeded yet. Run the seed command from §3 in the Render Shell and ask the invitee to retry.

### Everyone signed out after a deploy

Sessions are signed with `BETTER_AUTH_SECRET`. If the secret rotated (or was re-set in Render), every session is invalid and everyone must sign in again.

### Stale viewer — comments not showing

The artifact viewer polls the live conversation every 45 seconds and on window focus. If a reviewer doesn't see new comments, ask them to:
1. Focus the browser tab (triggers a focus-pull).
2. Wait up to 45 seconds.
3. Hard-reload the page (⌘R / Ctrl+R) — the artifact is served with `Cache-Control: no-store`.

If the author re-published after the reviewer loaded the page, the viewer adopts the new artifact on the next poll (the 410 stop-poll does not fire for a still-live link).

### 410 served to a reviewer

The author revoked the publication, or an operator took it down (§4). **Revocation is final:** the comments were deleted and the artifact removed, and the gateway refuses to republish a revoked publication (409). Don't clear `revokedAt` by hand; that would bring back an empty link. If the takedown was a mistake, the author publishes the document again, which mints a new link, and shares that one.

### `wrong_gateway` error in Prose

A local share entry records the gateway origin it was published against. If the entry was published to a different gateway URL than the one currently configured, Prose shows this error rather than silently mis-routing the revoke or republish. To fix: check `webPlatform.gatewayUrl` in `settings.json` and ensure it matches the entry's gateway. For the beta it must be `https://api.prose.solo.ist` (see §3). Entries published while pointed at another gateway, such as a local dev one, can only be managed with that gateway configured.

### Share URL didn't update after rename

As of PR #937, the `file:rename` IPC hook propagates renames to the share metadata. If a publication's URL is stale (pointed at an old path), the invitee should re-publish the document once to re-bake the link. The URL (token) stays the same.
