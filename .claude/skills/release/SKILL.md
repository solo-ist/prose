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
| `/release bump-build` | Increment `buildVersion` and rebuild MAS `.pkg` |
| `/release bump-version <version>` | Bump marketing version (e.g., `1.1.0`) |
| `/release status` | Check TestFlight processing, GitHub Release, and CI status |
| `/release checklist` | Run the pre-release verification checklist |

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

### 2. Reset build number

Edit `electron-builder.yml`: set `buildVersion: "1"`.

### 3. Commit

```bash
git add package.json package-lock.json electron-builder.yml
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
