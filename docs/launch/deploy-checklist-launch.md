# Deploy Checklist: Prose v1.0.0 — Mac App Store + Open Source Launch

**Date:** March 18, 2026 | **Deployer:** Angel
**Current Version:** 0.1.0-alpha.4 | **Target Version:** 1.0.0
**Distribution:** Mac App Store ($0.99 BYOK) + Direct Download (signed DMG via GitHub Releases)

---

## Phase 0 — Human Gates (longest lead times, start immediately)

### 0A: Apple Developer Portal

- [ ] Create "Developer ID Application" certificate (for DMG notarization)
- [ ] Create "Apple Distribution" certificate (for MAS submission)
- [ ] Create Mac App Store provisioning profile for `com.prose.app`
- [ ] Export both certificates as `.p12` files
- [ ] Generate app-specific password at appleid.apple.com (for notarization)
- [ ] Record Team ID: `_______________`
- [ ] Create app record in App Store Connect:
  - Bundle ID: `com.prose.app` *(already matches `electron-builder.yml`)*
  - Category: Productivity
  - Price: $0.99
- [ ] Add GitHub Actions secrets:
  - `CSC_LINK` (base64-encoded .p12)
  - `CSC_KEY_PASSWORD`
  - `APPLE_ID`
  - `APPLE_APP_SPECIFIC_PASSWORD`
  - `APPLE_TEAM_ID`

### 0B: Privacy Policy

- [ ] Draft privacy policy covering:
  - No data collected by developer (BYOK model)
  - No analytics, no telemetry (Sentry is opt-in, disclose if keeping)
  - Document content sent to `api.anthropic.com` only when user initiates AI chat
  - API keys stored via OS `safeStorage` (never plaintext)
  - Files stay local on device
- [ ] Host at stable URL (e.g., `prose.so/privacy` or GitHub Pages)
- [ ] Verify URL is live and accessible

---

## Phase 1 — Foundation (3 parallel agent worktrees)

### 1A: Open-Source Prep (issue #197)

**Status:** Not started. No `LICENSE` file exists. No branch created yet.

- [ ] Create branch `issue-197-open-source-prep` in worktree
- [ ] Create `LICENSE` file (MIT)
- [ ] Add `"license": "MIT"` to `package.json`
- [ ] Update `README.md`:
  - Remove unsigned app warning
  - Add privacy section
  - Add build-from-source instructions
- [ ] Verify no secrets in git history (confirmed clean — all credentials are env vars)
- [ ] PR created and merged

### 1B: Auto-Update (issue #191)

**Status:** Branch `issue-191-auto-update` exists with 3 commits (updater.ts, MAS gating, error recovery). Needs rebase onto main (30+ commits behind).**

- [ ] Rebase `issue-191-auto-update` onto current `main`
- [ ] Verify `src/main/updater.ts` has `__IS_MAS_BUILD__` gate
- [ ] Verify `src/renderer/components/layout/UpdateBanner.tsx` renders correctly
- [ ] Fix `afterPack.js` path reference (branch may reference `scripts/`, main has `build/`)
- [ ] Add `__IS_MAS_BUILD__` define to `electron-vite.config.ts`
- [ ] Add `publish: github` + `zip` target to `electron-builder.yml`
- [ ] Create `.github/workflows/release.yml` stub (extended in Phase 2)
- [ ] Verify `npm run build` succeeds after rebase
- [ ] PR created and merged

### 1C: Google Docs → Beta Waitlist (issue #120)

**Status:** Not started. `GoogleDocsIntegration.tsx` exists with full sync UI. 13 `google:*` IPC handlers in `ipc.ts`.**

- [ ] Create branch `issue-120-google-docs-waitlist` in worktree
- [ ] Replace `GoogleDocsIntegration.tsx` content with "Coming in v1.1" + waitlist link
- [ ] Gate `google:startAuth` IPC handler behind `__IS_MAS_BUILD__` (OAuth callback starts HTTP server — needs `network.server` entitlement, incompatible with MAS sandbox)
- [ ] Leave remaining 12 `google:*` IPC handlers intact (harmless, reduces risk)
- [ ] Verify Settings panel renders correctly with waitlist UI
- [ ] PR created and merged

### Phase 1 Merge Order

```
1A (LICENSE, README) → 1B (auto-update) → 1C (Google waitlist)
```

Known conflict: `src/renderer/types/index.ts` — 1B adds updater types, 1C touches google types. Sequential merge resolves this.

- [ ] All three merged to `main` in correct order
- [ ] `npm run build` succeeds on `main` after all merges
- [ ] App launches and runs correctly
- [ ] LICENSE file present at repo root
- [ ] Google Docs settings shows waitlist (not sync UI)
- [ ] Auto-update banner renders (test with mock)

---

## Phase 2 — Code Signing + Release Pipeline (after Phase 1 + 0A certs)

### 2A: Signing, Notarization, CI Release (issues #26, #247)

**Status:** Not started. No `release.yml` workflow exists. Current `entitlements.mac.plist` only has `allow-unsigned-executable-memory`. `electron-builder.yml` has `identity: null`.

- [ ] Create branch `issue-247-signing-release-pipeline` in worktree
- [ ] Update `electron-builder.yml`:
  ```yaml
  mac:
    identity: "Developer ID Application"
    notarize:
      teamId: ${APPLE_TEAM_ID}
    hardenedRuntime: true
    entitlements: build/entitlements.mac.plist
    entitlementsInherit: build/entitlements.mac.plist
    target: [dmg, zip, dir]
  ```
- [ ] Extend `build/entitlements.mac.plist` (currently only has `allow-unsigned-executable-memory`):
  - `com.apple.security.cs.allow-unsigned-executable-memory` ✅ (exists)
  - `com.apple.security.network.client` (Anthropic API, reMarkable, Google)
  - `com.apple.security.network.server` (MCP HTTP on 9877 — DMG only, NOT MAS)
  - `com.apple.security.files.user-selected.read-write` (file dialogs)
- [ ] Create/extend `.github/workflows/release.yml`:
  - Trigger on `v*` tags
  - macOS runner with signing env vars
  - `npm run build:mac` step
  - Notarization step (`notarytool`)
  - Publish to GitHub Releases (DMG + ZIP)
- [ ] Test: `npm run build:mac` produces DMG locally
- [ ] Test: `spctl --assess dist/mac-arm64/Prose.app` passes (requires cert)
- [ ] PR created and merged
- [ ] Test: CI release workflow creates GitHub Release on tag push

---

## Phase 3 — MAS Submission Build (after Phase 2)

### 3A: MAS Entitlements + Sandbox Adaptations (issue #138)

**Status:** Not started. No MAS entitlements files exist. No `__IS_MAS_BUILD__` references in source code yet (will be added by Phase 1B).

- [ ] Create branch `issue-138-mas-submission` in worktree
- [ ] Create `build/entitlements.mas.plist`:
  - `com.apple.security.app-sandbox` (required for MAS)
  - `com.apple.security.cs.allow-unsigned-executable-memory` (V8 JIT)
  - `com.apple.security.network.client` (API calls)
  - `com.apple.security.files.user-selected.read-write` (file dialogs)
  - `com.apple.security.files.bookmarks.app-scope` (remember file locations)
  - **NO** `com.apple.security.network.server`
- [ ] Create `build/entitlements.mas.inherit.plist`:
  - `com.apple.security.app-sandbox`
  - `com.apple.security.inherit`
- [ ] Add MAS stanza to `electron-builder.yml`:
  ```yaml
  mas:
    category: public.app-category.productivity
    entitlements: build/entitlements.mas.plist
    entitlementsInherit: build/entitlements.mas.inherit.plist
    target: [mas]
  ```
- [ ] Gate HTTP MCP server in `src/main/index.ts`:
  ```typescript
  if (!__IS_MAS_BUILD__) {
    mcpServer.setAuthToken(mcpAuthToken)
    await mcpServer.start()
  }
  ```
- [ ] Gate MCP install handler in `src/main/ipc.ts`:
  ```typescript
  if (__IS_MAS_BUILD__) {
    return { success: false, error: 'MCP auto-install is only available in the direct download version' }
  }
  ```
- [ ] Add `"build:mas": "MAS_BUILD=1 npm run build && electron-builder --mac mas"` to `package.json`
- [ ] Bump version to `1.0.0` in `package.json`
- [ ] Test: `npm run build:mas` produces MAS package
- [ ] Test: HTTP MCP server does NOT start in MAS build
- [ ] Test: Unix socket MCP still works in MAS build
- [ ] Test: MCP install handler returns error in MAS build
- [ ] Test: File open/save works through sandbox
- [ ] PR created and merged

---

## Phase 4 — App Store Submission (Human)

### 4A: Upload and Submit

- [ ] Build MAS package: `npm run build:mas` (or CI tag push)
- [ ] Upload via Transporter or `xcrun altool`
- [ ] App Store Connect metadata:
  - App name: Prose
  - Subtitle: "AI-powered markdown editor"
  - Description: Focus on BYOK, privacy, local-first
  - Keywords: markdown, editor, AI, writing, anthropic, claude
  - Category: Productivity
  - Price: $0.99
  - Privacy policy URL: (from 0B)
  - Support URL
- [ ] Screenshots (5 required at 2560×1600):
  - [ ] Editor with document open (light or dark theme)
  - [ ] AI chat panel in action
  - [ ] File explorer sidebar
  - [ ] Settings / API key configuration
  - [ ] Review mode (side-by-side diff)
- [ ] Review notes for Apple:
  - Explain `allow-unsigned-executable-memory` (Electron/Chromium V8 JIT — standard for all Electron apps)
  - Explain `network.client` (user-initiated API calls to Anthropic only)
  - Note: app requires user's own Anthropic API key (BYOK model)
- [ ] Submit for App Review (expect 1–3 business days)

### 4B: Post-Approval

- [ ] Make repo public (if not already done in Phase 1)
- [ ] Create GitHub Release with v1.0.0 tag (triggers signed DMG pipeline)
- [ ] Verify DMG auto-update works for existing alpha users
- [ ] Announce launch

---

## Rollback Plan

| Scenario | Action |
|---|---|
| MAS rejection | Fix cited issues, resubmit. DMG channel unaffected. |
| Signed DMG crashes | Revert to unsigned alpha DMG via GitHub Release rollback |
| Auto-update breaks | Users can manually download from GitHub Releases |
| Sandbox breaks file access | Emergency patch to entitlements, resubmit |

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| MAS rejection on first submission | 3–5 day delay | Document every entitlement in review notes. Pre-test with `altool --validate-app` |
| HTTP MCP + MAS sandbox | Build rejection | Disabled in MAS builds; Unix socket only |
| `allow-unsigned-executable-memory` in MAS | Possible concern | Standard for Electron/Chromium apps; include explanation in review notes |
| Auto-update needs public repo | Blocks direct-download updates | Repo goes public in Phase 1 |
| Google OAuth verification (deferred) | v1.1 delay | Not a launch blocker — replaced with waitlist UI |
| Sentry opt-in disclosure | MAS privacy review | Disclose in privacy policy or remove before submission |

---

## Critical File Map

| File | Phase | Status |
|---|---|---|
| `LICENSE` | 1A | **Missing — needs creation** |
| `package.json` | 1A, 1B, 3A | Exists (v0.1.0-alpha.4) |
| `electron-builder.yml` | 1B, 2A, 3A | Exists (`identity: null`, no MAS stanza) |
| `electron-vite.config.ts` | 1B | Exists (no `__IS_MAS_BUILD__` define) |
| `src/main/updater.ts` | 1B | **On branch only** (issue-191) |
| `src/renderer/components/layout/UpdateBanner.tsx` | 1B | **On branch only** (issue-191) |
| `src/renderer/components/settings/GoogleDocsIntegration.tsx` | 1C | Exists (full sync UI) |
| `src/main/ipc.ts` | 1C, 3A | Exists (13 google handlers, no MAS gates) |
| `src/main/index.ts` | 3A | Exists (no MAS gates) |
| `build/entitlements.mac.plist` | 2A | Exists (only `allow-unsigned-executable-memory`) |
| `build/entitlements.mas.plist` | 3A | **Missing — needs creation** |
| `build/entitlements.mas.inherit.plist` | 3A | **Missing — needs creation** |
| `.github/workflows/release.yml` | 1B, 2A | **Missing — needs creation** |
| `build/afterPack.js` | Exists | ✅ Fuses configured correctly |

---

## Sentry Decision (Pre-Launch)

The app has opt-in Sentry error tracking (merged on `main`). Decide before MAS submission:

- [ ] **Option A:** Keep Sentry, disclose in privacy policy as opt-in crash reporting
- [ ] **Option B:** Remove Sentry before v1.0.0 to simplify MAS privacy review

If keeping: update privacy policy to mention optional, opt-in crash reporting via Sentry. Apple may ask about it during review.
