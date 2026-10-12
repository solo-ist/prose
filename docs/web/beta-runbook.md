# Invite-Only Share Beta — Operator Runbook

**Applies to:** Prose 1.8.0 and later (`main`). The share code merged from `web-foundations` in 1.8.0 (#945).
**Owner:** Angel · **Audience:** operator (you, running the Render service)

---

## 1. What the beta is

The share service lets a desktop Prose user publish a document as a self-contained HTML artifact at `https://<label>.share.prose.solo.ist/s/<token>`. Invited reviewers open the link in any browser — no account, no install.

Key constraints for the beta:

- **Invite-only.** Publishing requires the `share_publish` entitlement. The operator grants it by email **before** sending the invite; it is claimed the first time the invitee publishes (#965).
- **Ships in the regular release.** Sharing is part of every direct-download build from 1.8.0 on, switched off. Invitees don't need a separate build; they update Prose as usual and turn the flag on (see §3). The `web-foundations` umbrella branch is retired, and the gateway deploys from `main`.
- **Desktop only, behind a flag.** The share surface lives behind the `webPlatform` feature flag, which is off by default. Invitees enable it by hand (see §3).
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
| `RESEND_API_KEY` | Delivers sign-in code emails via Resend | Obtain from resend.com; sender domain must be verified (SPF + DKIM) |
| `MAIL_FROM` | The `From` address on outbound emails | Must be on a Resend-verified domain, e.g. `prose@prose.solo.ist` |
| `R2_ACCOUNT_ID` | Cloudflare account ID for artifact storage | Required for `storage: 'r2'` |
| `R2_ACCESS_KEY_ID` | R2 API token key ID | Required for R2 |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret | Required for R2 |
| `R2_BUCKET` | R2 bucket name for artifacts | Required for R2 |
| `OPERATOR_EMAIL` | Where sharing access requests go (#1018) | Your own address. Optional: without it, requests are still recorded (`grant --list`), but nobody is emailed |
| `SHARE_SUBDOMAINS` | Enables per-publication subdomain routing (#938) | Set to `1` **only after** the wildcard `*.share.prose.solo.ist` DNS and TLS are live on Render — see the deploy order in §5 |

> **Removed in #934:** `AUTH_MAGIC_LINK_STDOUT` is no longer read. Delete it from the Render env if it was set.

The gateway validates all required vars at boot and exits non-zero with a clear error message if any are missing.

---

## 3. Granting an invitee

### What you do (operator)

1. Confirm the Render service is healthy: `curl https://api.prose.solo.ist/health` should return `{"ok":true,"service":"prose-gateway"}`.
2. **Grant by email, before sending anything.** The invitee doesn't need an account yet. Run the grant as a Render one-off job (or in a Render Shell) on the `prose-gateway` service; one command covers a whole wave:
   ```bash
   npm run grant -- --email a@example.com,b@example.com --feature share_publish --by beta
   ```
   Each email prints `invited` (no account yet; claimed on their first publish) or `granted` (account exists). It's idempotent, so re-running is safe. Optional flags: `--expires YYYY-MM-DD` (access lasts through that date, UTC), `--notes "wave 1"`, `--notify` (emails each address "Sharing is on" with a download link, so you don't have to write the invite yourself), `--dry-run`.
3. Send the invitee their invitation (see §6 for suggested copy).

To see who has access: `npm run grant -- --list --feature share_publish` (grants, invites not yet claimed, and **access requests waiting**).

### The waitlist (request access, #1018)

A signed-in user without the grant can press **Request access** in Prose. The gateway records one request per address and emails:
- the requester a confirmation
- you (`OPERATOR_EMAIL`), with reply-to set to the requester, and the exact command to approve them

To approve, run the command from that email as a one-off job:
```bash
npm run grant -- --email reader@example.com --feature share_publish --by beta --notify
```
Granting also clears their waitlist entry. To decline, do nothing; the request stays listed under `grant --list`.

### What the invitee does

1. **Update Prose to 1.8.0 or later.** Prose checks for updates on its own shortly after launch and offers to restart. Or download the DMG from the latest GitHub release.
2. **Enable the feature flag.** Quit Prose, open `~/Library/Application Support/Prose/settings.json` in a text editor, and add (or merge into the existing `featureFlags` block):
   ```json
   "featureFlags": { "webPlatform": true }
   ```
   Save the file, then relaunch Prose. The app already points at the production gateway (`DEFAULT_GATEWAY_URL` = `https://api.prose.solo.ist`), so no `gatewayUrl` setting is needed. A leftover `webPlatform.gatewayUrl` for any host other than `api.prose.solo.ist` or loopback is ignored.
3. **Sign in.** Open any document. A share icon (◎) appears in the top-right corner. Click it, enter the email address you granted, and press **Send code**. The gateway emails a 6-digit code via Resend.
4. **Complete sign-in.** Click **Open in Prose** in the email, or type the code into Prose (it signs in as soon as the sixth digit is entered). Codes last 10 minutes; **Resend code** sends a fresh one.
5. **Publish.** Click **Publish** in the share popover. It works on the first try: the gateway claims the invite into an entitlement on that request. The URL is `https://<label>.share.prose.solo.ist/s/<token>` (or `https://share.prose.solo.ist/s/<token>` if `SHARE_SUBDOMAINS` is not yet set).

The invite matches on the email the invitee signs in with (case-insensitive). If they sign in with a different address, grant that one too.

---

## 4. Revoking access and taking down publications

### Revoking an invitee's publish entitlement

```bash
npm run grant -- --email invitee@example.com --feature share_publish --revoke
```

This removes the entitlement if the account exists and withdraws the invite if it hasn't been claimed yet. It prints `revoked`, or `unchanged` if there was nothing to remove. The invitee's next publish returns 403. Existing published links remain live; take those down separately (below).

Rows with `grantedBy = 'opencollective'` belong to the Open Collective reconcile job (#953). The CLI never changes or removes them, and `--by opencollective` is rejected.

### Author-side publication takedown

To take down a **single comment** instead of the whole link, the invitee deletes that thread in Prose (the trash icon on the comment). For a shared thread this also removes it, with its replies, from the shared page. This is the answer when a reader asks for a comment carried over from an earlier version of the link to be removed: those comments can't be edited or deleted from the page.

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

### Email sign-in (no codes in logs)

Sign-in codes must travel by email only; they must **not** appear in Render logs. Verify:

1. Request a code for your own email via Prose desktop sign-in.
2. Open Render → Logs. Confirm no `[auth] Sign-in code for …` line appears. That line is printed only when `RESEND_API_KEY` is unset, which production config refuses at boot.
3. Confirm the email arrives, and that typing the code signs you in.

### Publish + subdomain URL

After granting yourself `share_publish` (`npm run grant -- --email <you> --feature share_publish --by manual`):

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
1. Make sure you're on Prose 1.8.0 or later. Prose updates itself shortly after launch; if it hasn't yet, download the latest release from <link to the latest release>. Your documents and settings stay where they are.
2. Quit Prose, open `~/Library/Application Support/Prose/settings.json`, and add this entry (merge it into `featureFlags` if that block already exists, and keep the commas valid):
   `"featureFlags": { "webPlatform": true }`
   Then relaunch Prose.
3. Click the ◎ icon in the top-right corner of any document, enter this email address (the one I sent the invite to), and press **Send code**. Click **Open in Prose** in the email, or type its 6-digit code into Prose. That's it: the **Publish** button works straight away.

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

### Sign-in code not arriving

- If Prose showed "The sign-in email couldn't be sent", Resend rejected it: check Render logs for `[auth] failed to send a sign-in code` and the `[mail]` line before it.
- "Too many codes sent to this address" means 5 codes in the last hour; wait it out.
- Confirm `RESEND_API_KEY` is set and the sender domain is verified in the Resend dashboard (SPF + DKIM). Unverified domains fail silently or bounce.
- Check spam. The `From` address is whatever `MAIL_FROM` is set to.
- In the Render Shell, you can send a test request directly:
  ```bash
  curl -X POST https://api.prose.solo.ist/api/sign-in/code \
    -H 'Content-Type: application/json' \
    -d '{"email":"you@example.com"}'
  ```
  `{"ok":true}` means Resend accepted it; anything else names the failure.

### "Open in Prose" does nothing

The button goes to `https://api.prose.solo.ist/auth/code`, which shows the code and asks the browser to open `prose-signin://auth`. Only the GitHub (DMG) build registers `prose-signin://`; the App Store build doesn't, so an App Store copy installed alongside the beta never receives the link. Prose accepts that link only from the window that is still waiting for this code. It ignores the link if Prose was quit and reopened, if a newer code was requested, or after 10 minutes. In all those cases, type the code the page shows (or request a new one). Some browsers ask "Open Prose?" first, and dev builds (`npm run dev`) don't register `prose-signin://` at all. If the wrong copy of Prose opens, an old build may still be registered; `lsregister -dump | grep -B30 "prose-signin"` lists the claimants (`lsregister` is in `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/`), and `lsregister -u <path>` drops one.

### "That code isn't right" / "Too many wrong tries"

Each code allows 5 wrong tries, then it's burned (even the right code fails) and the invitee needs **Resend code**. Codes also expire after 10 minutes, and only the newest code for an address works.

### 403 on publish — entitlement not granted

Run `npm run grant -- --list --feature share_publish`. Common causes:

- **No grant for that email.** Grant it (§3) and ask the invitee to retry.
- **They signed in with a different address** than the one you granted. The pending invite stays under the granted address; grant the address they actually used.
- **The grant or invite expired** (`until=` in the past). Re-grant with a later `--expires`, or without one.

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

A local share entry records the gateway origin it was published against. If the entry was published to a different gateway URL than the one currently configured, Prose shows this error rather than silently mis-routing the revoke or republish. Remove any `webPlatform.gatewayUrl` from `settings.json`; the build's default is the production gateway. Entries published while pointed at another gateway, such as a local dev one, can only be managed with that gateway configured. The old `prose-gateway.onrender.com` host is no longer on the allowlist, so entries minted there can't be managed from a release build; republish the document to get a fresh link.

### Share URL didn't update after rename

As of PR #937, the `file:rename` IPC hook propagates renames to the share metadata. If a publication's URL is stale (pointed at an old path), the invitee should re-publish the document once to re-bake the link. The URL (token) stays the same.
