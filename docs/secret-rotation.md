# Secret & Credential Rotation

Emergency and routine rotation protocol for all secrets in the Prose project.

## Quick Reference

| Secret | File | Rotation URL |
|--------|------|-------------|
| Google OAuth Client ID/Secret | `.env` | [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) |
| reMarkable OCR Lambda URL | `.env` | AWS Console → API Gateway / Lambda |
| reMarkable OCR API Key | `.env` | AWS Console → API Gateway → API Keys |
| Sentry Auth Token | `.env.sentry-build-plugin` | [Sentry → Auth Tokens](https://sentry.io/settings/auth-tokens/) |
| GitHub PAT (CI) | GitHub repo secrets | [GitHub → Settings → Tokens](https://github.com/settings/tokens) |
| App Store Connect API Key | `~/.appstoreconnect/private_keys/` | [App Store Connect → Users & Access → Keys](https://appstoreconnect.apple.com/access/integrations/api) |

## Secret Locations

### `.env` (gitignored, Claude Code denied)
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
REMARKABLE_OCR_URL=...
REMARKABLE_OCR_API_KEY=...
```

### `.env.sentry-build-plugin` (gitignored, Claude Code denied)
```
SENTRY_AUTH_TOKEN=...
```

### GitHub repo/org secrets (not local)
```
ANTHROPIC_API_KEY — set at org level (solo-ist), used by CI workflows
```

### `~/.appstoreconnect/private_keys/AuthKey_73DLM4525G.p8` (local only)
App Store Connect API key for `xcrun altool` uploads.

## Rotation Procedures

### 1. Google OAuth (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create a new OAuth 2.0 Client ID (Desktop app type)
3. Copy the new Client ID and Client Secret
4. Update `.env` with new values
5. Delete the old Client ID in the console
6. Test: `npm run dev` → Settings → Google Docs → attempt OAuth flow

### 2. reMarkable OCR (REMARKABLE_OCR_URL / REMARKABLE_OCR_API_KEY)

1. Go to AWS Console → API Gateway (or Lambda, depending on auth setup)
2. Rotate the API key (create new, then delete old)
3. If the Lambda function URL changed, update `REMARKABLE_OCR_URL`
4. Update `.env` with new values
5. Test: Open a reMarkable notebook → trigger OCR transcription

### 3. Sentry Auth Token

1. Go to [Sentry → Auth Tokens](https://sentry.io/settings/auth-tokens/)
2. Create a new token with scopes: `project:releases`, `org:read`
3. Update `.env.sentry-build-plugin` with new token
4. Revoke the old token in Sentry
5. Test: `npm run build` — source maps should upload without errors

### 4. GitHub PAT (CI workflows)

1. Go to [GitHub → Developer Settings → Tokens](https://github.com/settings/tokens)
2. Generate a new fine-grained token with `repo` scope for `solo-ist/prose`
3. Update in GitHub: repo → Settings → Secrets → Actions → `GITHUB_TOKEN` (if custom)
4. Revoke the old token
5. Test: Push a commit, verify CI workflows run

### 5. App Store Connect API Key

1. Go to [App Store Connect → Users & Access → Integrations → Keys](https://appstoreconnect.apple.com/access/integrations/api)
2. Generate a new key (Admin role)
3. Download the `.p8` file to `~/.appstoreconnect/private_keys/`
4. Update the key ID in the upload command (and in Claude Code memory if stored)
5. Revoke the old key in App Store Connect
6. Test: `xcrun altool --upload-app --type macos --file <pkg> --apiKey <NEW_KEY_ID> --apiIssuer <ISSUER_ID>`

### 6. ANTHROPIC_API_KEY (CI)

1. Go to [Anthropic Console → API Keys](https://console.anthropic.com/settings/keys)
2. Create a new key
3. Update at org level: `gh secret set ANTHROPIC_API_KEY --org solo-ist --body <new-key>`
4. Revoke the old key in Anthropic Console
5. Test: Open a PR to trigger `claude.yml` workflow

## Emergency Rotation (all at once)

If a breach is suspected, rotate everything in this order:

1. **GitHub PAT** — highest blast radius (repo access)
2. **ANTHROPIC_API_KEY** — billing exposure
3. **App Store Connect** — app distribution access
4. **Google OAuth** — user data access (if OAuth verified)
5. **Sentry** — crash report access (low risk)
6. **reMarkable OCR** — Lambda invocation (low risk)

After rotation:
- Run `npm run build` to verify Sentry source map upload
- Run `npm run dev` to verify app starts and settings load
- Push a test commit to verify CI workflows

## Prevention

- `.env`, `.env.sentry-build-plugin`, and `.mcp.json` are gitignored
- Claude Code deny list blocks `Read` and `Edit` on all secret files (`.claude/settings.json`)
- Provisioning profiles are gitignored and Claude Code denied
- Never paste secrets into chat, issues, PRs, or commit messages
