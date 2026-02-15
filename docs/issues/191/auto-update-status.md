# Auto-Update: Current State & Next Steps

## What's Built

The auto-update infrastructure is complete on `issue-191-auto-update`:

- **`src/main/updater.ts`** — electron-updater integration with `autoDownload: false`, 10s initial check, 4h periodic checks
- **UpdateBanner component** — renders between toolbar and editor; three states (available → downloading → ready to restart)
- **Full IPC bridge** — preload, types, browser fallbacks all wired up
- **`electron-builder.yml`** — `publish: { provider: github }` config, `zip` target added (required by electron-updater)
- **`.github/workflows/release.yml`** — CI pipeline triggered on `v*` tags, builds + publishes to GitHub Releases
- **PR #192** is open

## What Broke During Testing

**The repo is private.** electron-updater's GitHub provider fetches release assets via unauthenticated HTTPS (`/releases.atom`, `latest-mac.yml`). Private repos return 404 for unauthenticated requests. There's no safe way to ship a GitHub token inside the app binary.

Other issues fixed along the way:
- `cp -R` of ad-hoc signed `.app` breaks the code signature (macOS rejects mismatched Team IDs between the binary and Electron Framework) — fixed by re-signing after copy
- `electron-builder --dir` doesn't generate `app-update.yml` — needs a full build or manual file placement
- Prerelease GitHub releases are invisible to `/releases/latest` endpoint — fixed by adding `allowPrerelease: true`

## The MAS Question

If Prose ships both a **Mac App Store** version and an **OSS/direct-download** version, auto-update only applies to the direct-download version. MAS handles its own updates. This means the auto-update strategy only needs to serve the direct-download channel.

## Options

### 1. Make the repo public
- **Pros:** Zero infrastructure, electron-updater's GitHub provider works as-is
- **Cons:** Source code is public (may be fine for OSS version)

### 2. Separate public release repo
- Create `solo-ist/prose-releases` (public), publish release assets there
- Change `publish` config to point to the releases repo
- **Pros:** Source stays private, no infrastructure
- **Cons:** Extra repo to manage, CI uploads to a different repo

### 3. Static file host (S3 / Cloudflare R2 / GitHub Pages)
- Use electron-updater's `generic` provider instead of `github`
- Upload `latest-mac.yml` + zip to a static URL (e.g., `https://releases.prose.app/`)
- **Pros:** Works regardless of repo visibility, fast CDN delivery, no token needed
- **Cons:** Requires hosting setup, CI needs upload credentials

### 4. Custom update server (Hazel / Nuts)
- Self-hosted server that proxies GitHub Releases (handles auth server-side)
- **Pros:** Repo stays private, server handles token
- **Cons:** Another service to run and maintain — overkill for a solo project

## Recommendation

**Option 2 or 3**, depending on whether the repo will eventually go public:

- If Prose goes OSS → **Option 1** (just flip the repo to public, everything works)
- If Prose stays private → **Option 3** (Cloudflare R2 is free-tier friendly, simple CI integration)
- **Option 2** is a good middle ground if you want to decide later

## What's Left After Strategy Decision

1. Update `publish` config in `electron-builder.yml` to match chosen provider
2. Update CI workflow if not using GitHub provider
3. Test full flow end-to-end (banner → download → restart)
4. Clean up test release `v0.1.0-alpha.5` from GitHub
5. Merge PR #192

## Test Release Cleanup

A test release `v0.1.0-alpha.5` exists on GitHub (currently marked as non-prerelease). Delete it once testing is complete:

```bash
gh release delete v0.1.0-alpha.5 --repo solo-ist/prose --yes
git push --delete origin v0.1.0-alpha.5
```
