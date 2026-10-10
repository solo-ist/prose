---
name: release
description: Create a new Prose release with automated testing, GitHub release, and local verification.
---

# Release Manager

Manages the full release workflow for Prose across two distribution channels:
- **Mac App Store** — signed `.pkg` uploaded via Transporter → TestFlight → App Store
- **GitHub Releases** — signed `.dmg` + `.zip` published to GitHub for direct download + auto-update

## Usage

```
/release [command]
```

### Commands

| Command | Description |
|---------|-------------|
| `/release` | Show current version, build number, and release status |
| `/release mas` | Build and prepare MAS `.pkg` for Transporter upload |
| `/release github` | Build DMG and create GitHub Release |
| `/release copy` | Update the solo.ist/prose marketing copy after a release |
| `/release bump-build` | Increment `buildVersion` and rebuild MAS `.pkg` |
| `/release bump-version <version>` | Bump marketing version (e.g., `1.1.0`) |
| `/release smoke` | Build the DMG and walk 7 critical paths (~5 min) — fast pre-release sanity check |
| `/release status` | Check TestFlight processing, GitHub Release, and CI status |
| `/release checklist` | Run the full pre-release verification checklist |

---

## Architecture

### Version Numbers

Two version numbers, managed independently:

- **Marketing version** (`CFBundleShortVersionString`): Set in `package.json` `"version"`. Example: `1.0.0`. This is what users see. Must match the App Store Connect record.
- **Build number** (`CFBundleVersion`): Set in `electron-builder.yml` `"buildVersion"`. Example: `"2"`. Incremented for each upload to App Store Connect. GitHub Releases don't care about this.

### Signing Identities

| Build | Identity | Profile |
|-------|----------|---------|
| DMG (direct download) | `Developer ID Application` | None (notarized via CI) |
| MAS (App Store) | `Apple Distribution` (via team ID `8PT2Y7QQ2F`) | `build/Prose_Distribution.provisionprofile` |
| MAS `.pkg` installer | `3rd Party Mac Developer Installer` | N/A |

### Bundle ID

`ist.solo.prose` — used across all builds. Must match provisioning profiles and App Store Connect.

### Key Files

| File | Purpose |
|------|---------|
| `package.json` | Marketing version (`"version"`) |
| `electron-builder.yml` | Build number (`buildVersion`), signing config, targets |
| `build/entitlements.mac.plist` | DMG entitlements (includes `network.server` for MCP) |
| `build/entitlements.mas.plist` | MAS entitlements (sandbox, no `network.server`) |
| `build/entitlements.mas.inherit.plist` | Child process entitlements for MAS |
| `build/Prose_Distribution.provisionprofile` | MAS distribution profile |
| `build/afterPack.cjs` | Electron fuse flipping |
| `.github/workflows/release.yml` | CI: builds signed DMG on `v*` tag push |

---

## Workflow: MAS Release (`/release mas`)

### 1. Pre-flight

```bash
git branch --show-current          # Must be on release branch or main
git status --porcelain             # Must be clean
node -p "require('./package.json').version"   # Current marketing version
grep buildVersion electron-builder.yml        # Current build number
```

### 2. Build

```bash
# Clean previous builds
rm -rf dist/mas-arm64

# Build with MAS_BUILD flag (gates HTTP MCP server, auto-updater)
npm run build:mas
```

### 3. Verify

```bash
# Check .pkg exists
ls -la dist/mas-arm64/*.pkg

# Verify version strings
plutil -p dist/mas-arm64/Prose.app/Contents/Info.plist | grep -E "CFBundleVersion|CFBundleShortVersion"

# Verify code signature
codesign --verify --deep --strict dist/mas-arm64/Prose.app

# Verify entitlements
codesign -d --entitlements - dist/mas-arm64/Prose.app 2>&1 | head -20
```

**Entitlements must include:** `app-sandbox`, `allow-jit`, `network.client`, `files.user-selected.read-write`, `bookmarks.app-scope`

**Entitlements must NOT include:** `network.server`, `get-task-allow`

### 4. Upload to App Store Connect

```bash
xcrun altool --upload-app \
  --type macos \
  --file dist/mas-arm64/Prose-1.0.0-arm64.pkg \
  --apiKey 73DLM4525G \
  --apiIssuer f46c81a3-3264-4e9d-9b2f-93de6a302175
```

The API key `.p8` file lives at `~/.appstoreconnect/private_keys/AuthKey_73DLM4525G.p8`.

### 5. Report

```
## MAS Build Uploaded

- **Version:** <version> (build <N>)
- **Package:** dist/mas-arm64/Prose-<version>-arm64.pkg
- **Signed:** Apple Distribution + 3rd Party Mac Developer Installer
- **Delivery UUID:** <from upload output>

### Next steps
1. Wait for processing in App Store Connect (~10 min)
2. Test via **TestFlight** on your Mac
3. **HUMAN ONLY:** When satisfied, submit for App Store review manually in App Store Connect

⚠️ **NEVER submit for App Store review programmatically.** This is always a human decision. The automated workflow stops at TestFlight upload.
```

---

## Workflow: GitHub Release (`/release github`)

### 1. Pre-flight

```bash
git branch --show-current          # Should be main (after PR merge)
git status --porcelain             # Must be clean
```

### 2. Build

```bash
rm -rf dist/mac-arm64
npm run build:mac
```

### 3. Verify

```bash
# Check outputs
ls -la dist/Prose-*-arm64.dmg dist/Prose-*-arm64-mac.zip

# Verify signature
codesign --verify --deep --strict dist/mac-arm64/Prose.app

# Verify entitlements include network.server (MCP)
codesign -d --entitlements - dist/mac-arm64/Prose.app 2>&1 | grep network.server
```

### 4. Generate Release Notes

```bash
# Commits since last release
git log $(git tag --list 'v*' --sort=-v:refname | head -1)..HEAD --oneline --no-merges
```

Write release notes from commits. Template:

```markdown
# Prose v<version>

<One sentence description.>

## What's New

- <Feature or fix>

## Installation

### Mac App Store
Available on the [Mac App Store](link).

### Direct Download
Download `Prose-<version>-arm64.dmg`, open, and drag to Applications.
The app is signed and notarized — no security bypass needed.

### Auto-Update
Existing users will be prompted to update automatically.

## Requirements

- macOS (Apple Silicon)
- Anthropic API key for AI features ([get one](https://console.anthropic.com/))
```

### 5. Tag and Publish

```bash
VERSION=$(node -p "require('./package.json').version")

# Create tag
git tag "v${VERSION}"
git push origin "v${VERSION}"
```

The tag push triggers `release.yml` which builds, signs, notarizes, and publishes the DMG + ZIP to GitHub Releases automatically.

If CI is not available or you want to publish manually:

```bash
gh release create "v${VERSION}" \
  --title "Prose v${VERSION}" \
  --notes-file RELEASE_NOTES.md \
  "dist/Prose-${VERSION}-arm64.dmg" \
  "dist/Prose-${VERSION}-arm64-mac.zip"
```

### 6. Update the marketing copy

The release is not finished when the tag is published. Run **`/release copy`** (next section) to bring solo.ist/prose up to the version you just shipped — nothing in CI does this, and the page has drifted five releases behind before.

---

## Workflow: Post-release Marketing Copy (`/release copy`)

Run this **after** a GitHub release publishes (and again when a MAS version clears review, if the App Store link or availability changed). The marketing site is a **separate repo** and nothing in CI touches it — if this step is skipped, solo.ist/prose silently falls behind. It sat pinned at v1.6.2 through five releases because this section didn't exist.

### Where the copy lives

| Repo | Path | What it is |
|------|------|------------|
| `solo-ist/solo-ist` (`~/Code/solo.ist`) | `prose/index.html` | The solo.ist/prose page — hand-authored HTML, no build step |
| `solo-ist/solo-ist` | `COPY.md` | Canonical copy mirror for solo.ist and its project pages |
| `solo-ist/prose` | `docs/app-store-copy.md` | App Store listing copy — canonical **here**, not in the site repo |

Vercel deploys `solo-ist/solo-ist` on push to `main`. `prose/index.html` has no build step — it ships exactly as authored, so a typo is live the moment the PR merges.

### 1. Pre-flight

```bash
git -C ~/Code/solo.ist fetch origin
git -C ~/Code/solo.ist status --porcelain
gh release list --repo solo-ist/prose --limit 10
```

Working tree must be clean. Branch off freshly-fetched `main`:

```bash
git -C ~/Code/solo.ist checkout -b prose-v<version>-copy origin/main
```

Use `git -C <path>` rather than `cd && git` — compound chains get flagged for manual approval and block unattended agents.

### 2. Read every release since the last copy update

Not just the newest one. Find where the copy actually left off:

```bash
git -C ~/Code/solo.ist log -1 --format=%cI -- prose/index.html    # last time the page moved
gh release view <tag> --repo solo-ist/prose --json body -q .body  # for each tag since
```

Point releases are where the good material hides — a `.5` can carry far more user-facing change than the `.0` before it.

### 3. Walk the version-sensitive surfaces

Check **all** of these in `prose/index.html`. Each has gone stale at least once:

| # | Surface | Check against |
|---|---------|---------------|
| 1 | Nav version chip (`.nav-ver`) | Latest published release tag |
| 2 | "What's new" section label | The current release era |
| 3 | "What's new" cells (`.news-tag` / `.news-title` / `.news-desc`) | Everything shipped since the last copy update |
| 4 | "What's next" preview cell | `docs/roadmap.md` — reconcile, don't guess |
| 5 | MCP tool list (`.mcp-tools`) | `mcpToolNames` in `src/shared/tools/registry.ts` |
| 6 | Feature cards (`.feat-desc`) | A release may have widened a feature's scope |
| 7 | Hero sub-paragraph | Its twin in `COPY.md` — update both or neither |
| 8 | Download / App Store links | MAS link is live only once that version clears review |

### 4. Write it as marketing, not as a changelog

- Lead with what the reader can now **do**, not what was implemented.
- One idea per cell. If a cell needs a semicolon, it's two cells.
- Tag each cell with the version that actually **introduced** the feature (`v1.6.5 — Comments`), not the version being shipped — readers returning after a gap need to place it.
- Fold dependency bumps and internal refactors out entirely. If a release *is* the security story, give it one plainly-stated cell.
- Never invent a feature. Every claim traces back to a release note.

### 5. Verify locally

```bash
python3 -m http.server 8899 --directory ~/Code/solo.ist
```

Open <http://localhost:8899/prose/>. Pick an unused port — other agents may hold the common ones. Confirm the nav chip, the "What's new" grid at both desktop and narrow widths, and that no cell overflows its box.

### 6. Open the PR

```bash
git -C ~/Code/solo.ist add prose/index.html COPY.md
git -C ~/Code/solo.ist commit -m "feat(prose): refresh marketing copy for v<version>"
git -C ~/Code/solo.ist push -u origin prose-v<version>-copy
gh pr create --repo solo-ist/solo-ist --title "Prose v<version> marketing copy" --body "<summary>"
```

⚠️ **Never auto-merge and never push straight to `main`.** Marketing voice is a human call — the PR stops for review even when every fact in it is right.

### 7. Report

```
## Marketing Copy — v<version>

- **PR:** <url>
- **Updated:** <surfaces changed>
- **Checked, no change needed:** <surfaces>
- **Left stale, with reason:** <surfaces, or "none">
```

---

## Workflow: Quick Smoke Test (`/release smoke`)

Fast (~5 min) verification before tagging a GitHub release. Exercises the signed/notarized artifact users will actually receive — *not* dev mode. Use this for routine releases. Escalate to `/release checklist` if the release touches:

- Main-process IPC handlers or new IPC channels
- Entitlements (`build/entitlements.*.plist`)
- Sandbox / `contextIsolation` / `nodeIntegration` settings
- First build after an Electron major upgrade

### 1. Build (skip if fresh)

```bash
rm -rf dist/mac-arm64
npm run build:mac
```

### 2. Verify artifact

```bash
VERSION=$(node -p "require('./package.json').version")
ls -la "dist/Prose-${VERSION}-arm64.dmg" "dist/Prose-${VERSION}-arm64-mac.zip"
codesign --verify --deep --strict dist/mac-arm64/Prose.app
codesign -d --entitlements - dist/mac-arm64/Prose.app 2>&1 | grep network.server   # expect a match (MCP)
```

### 3. Launch the built app

```bash
open dist/mac-arm64/Prose.app
```

Do NOT use `npm run dev` — the smoke test must exercise the signed bundle.

### 4. Walk the 7 critical paths

| # | Path | Pass criteria |
|---|------|---------------|
| 1 | App launches | Window renders, no crash dialog, no console error storm |
| 2 | Editor round-trip | New file → type a paragraph → `Cmd+S` → close → reopen, content intact |
| 3 | Settings dialog | Opens cleanly, no outline/focus artifacts, closes cleanly |
| 4 | API key test | Settings → LLM → "Test API Key" returns success with current key |
| 5 | Chat streaming | Send a message in chat panel, response streams in fully |
| 6 | Skill download | Help → Download Prose Skill (or Settings → Integrations) downloads the `.zip` |
| 7 | `prose://` scheme | Trigger a `prose://` URL (Claude artifact → Open in Prose) and confirm the app handles it |

### 5. Clean up

```bash
rm -f electron-screenshot-*.jpeg
```

### 6. Report

```
## Smoke Test Results — v<version>

- [x] App launches
- [x] Editor round-trip
- [x] Settings dialog
- [x] API key test
- [x] Chat streaming
- [x] Skill download
- [x] prose:// scheme

Ready to tag.
```

If any path fails, fix before tagging. Do not ship on red smoke.

---

## Workflow: Bump Build Number (`/release bump-build`)

Used when you need to re-upload to App Store Connect (Transporter rejects duplicate version + build combos).

### 1. Read current

```bash
grep buildVersion electron-builder.yml
```

### 2. Increment

Edit `electron-builder.yml`: increment `buildVersion` (e.g., `"2"` → `"3"`).

### 3. Rebuild and verify

```bash
rm -rf dist/mas-arm64
npm run build:mas
plutil -p dist/mas-arm64/Prose.app/Contents/Info.plist | grep CFBundleVersion
```

### 4. Commit

```bash
git add electron-builder.yml
git commit -m "chore(build): bump build number to <N>"
git push origin <branch>
```

### 5. Upload

```bash
xcrun altool --upload-app \
  --type macos \
  --file dist/mas-arm64/Prose-1.0.0-arm64.pkg \
  --apiKey 73DLM4525G \
  --apiIssuer f46c81a3-3264-4e9d-9b2f-93de6a302175
```

Report the delivery UUID and wait for App Store Connect processing.

---

## Workflow: Bump Marketing Version (`/release bump-version <version>`)

### 1. Update package.json

```bash
npm version <version> --no-git-tag-version
```

### 2. Leave buildVersion alone

**Do not reset `buildVersion`.** This project uses a global monotonic build counter across marketing versions (e.g., 1.0.0 ended at build 20; first 1.0.1 MAS upload will be build 21). App Store Connect treats `version+build` as unique either way, and continuous numbering matches the established pattern.

### 3. Commit

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to <version>"
```

---

## Workflow: Pre-release Checklist (`/release checklist`)

Run through this before any release:

```
## Pre-release Checklist

### Build
- [ ] `npm run build` succeeds with no errors
- [ ] `npm run build:mac` produces signed DMG
- [ ] `npm run build:mas` produces signed .pkg
- [ ] `codesign --verify --deep --strict` passes on both builds

### App Verification (DMG build)
- [ ] App launches from dist/mac-arm64/Prose.app
- [ ] Editor: create file, type, save, reopen
- [ ] Settings dialog opens and closes without outline
- [ ] API key test passes (Settings > LLM > Test)
- [ ] Chat works with valid API key
- [ ] Feature flags: Google Docs and reMarkable hidden
- [ ] File explorer: no Google/reMarkable tabs
- [ ] Body does not scroll off screen

### MAS-specific
- [ ] HTTP MCP server disabled (check console for log message)
- [ ] MCP install returns error in MAS build
- [ ] Auto-updater disabled in MAS build

### Security
- [ ] No plaintext secrets in ~/.prose/settings.json
- [ ] DMG entitlements: allow-jit (not allow-unsigned-executable-memory)
- [ ] MAS entitlements: app-sandbox, no network.server
- [ ] Fuses flipped (RunAsNode, NodeOptions, CliInspect all false)

### CI
- [ ] E2E tests pass on PR
- [ ] Code review clean (no blocking issues)
```

---

## Troubleshooting

### Transporter rejects upload
- **"Duplicate version"**: Bump `buildVersion` in `electron-builder.yml` and rebuild
- **"Invalid signature"**: Check that `Apple Distribution` cert is in keychain and not expired
- **"Missing provisioning profile"**: Verify `build/Prose_Distribution.provisionprofile` exists and bundle ID matches `ist.solo.prose`

### MAS build fails at signing
- **"Cannot find valid 3rd Party Mac Developer Installer"**: Use team ID (`8PT2Y7QQ2F`) as identity in `mas:` block, not cert name
- **afterPack error "Unsupported platform: mas"**: Ensure `build/afterPack.cjs` handles the `mas` case

### DMG build hangs
- **Notarization hanging locally**: Don't set `notarize: true` in config. Notarization happens in CI via env vars (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`). Local builds skip it.

### GitHub Release workflow fails
- **Missing secrets**: Verify `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `SENTRY_AUTH_TOKEN` are set in repo secrets
- **Signing fails in CI**: `CSC_LINK` must be the base64-encoded `.p12` containing the Developer ID Application cert

### TestFlight build won't install
- **"App can't be opened"**: Distribution-signed MAS builds cannot run locally. Only TestFlight or App Store installs work.
