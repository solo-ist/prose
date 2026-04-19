# Prose 1.0.0 Launch Checklists

Comprehensive pre-launch checklists covering Mac App Store submission, Electron production release, BYOK security considerations, and open source readiness. Each section includes Prose-specific callouts where the dual-build (MAS + OSS), Sentry integration, and feature-flagged integrations (reMarkable, Google Docs) require special attention.

---

## 1. Mac App Store — First Submission

### Apple Developer Account & App Store Connect

- [ ] Enrolled in Apple Developer Program (annual fee, currently $99/yr)
- [ ] Created App ID (Bundle ID) in Apple Developer portal — must match `MAS_BUILD=1` bundle ID
- [ ] Created app record in App Store Connect (name, bundle ID, SKU, primary language)
- [ ] Selected app category (Productivity? Developer Tools?)
- [ ] Set pricing and availability (free with BYOK, or paid?)
- [ ] Chosen countries/regions for distribution
- [ ] Accepted any required Apple agreements (paid apps agreement, etc.)

### Certificates & Provisioning

- [ ] Generated **Mac App Distribution** certificate (for signing the MAS build)
- [ ] Generated **Mac Installer Distribution** certificate (for signing the .pkg)
- [ ] Created Mac App Store **provisioning profile** tied to your App ID
- [ ] Verified electron-builder is configured to use MAS-specific certs (not Developer ID)
- [ ] Confirmed the provisioning profile is embedded in the .app bundle

### Code Signing & Entitlements

- [ ] Main app has `com.apple.security.app-sandbox` set to `true`
- [ ] All helper apps (GPU, Renderer, Plugin) have sandbox entitlement with `com.apple.security.inherit` set to `true`
- [ ] Entitlements plist covers all required capabilities:
  - [ ] `com.apple.security.network.client` (outbound network for API calls)
  - [ ] `com.apple.security.files.user-selected.read-write` (file open/save dialogs)
  - [ ] `com.apple.security.files.bookmarks.app-scope` (if persisting file access across launches)
- [ ] No overly broad entitlements (absolute path read-write will be rejected)
- [ ] Verified that `npm run build:mas` signs all binaries (check with `codesign --verify --deep --strict`)
- [ ] Tested the MAS build actually launches under sandbox (don't just build — run it)

### Sentry Compatibility (MAS-Specific)

- [ ] **Native crash reporting is auto-disabled in MAS builds** — Sentry cannot collect Minidumps under App Store sandbox. Verified this doesn't cause errors or unexpected behavior.
- [ ] JavaScript-level error reporting still works in MAS sandbox (confirm in testing)
- [ ] Sentry DSN is not exposed in a way that violates App Store data collection rules
- [ ] Sentry is opt-in only (your current Settings toggle) — this is required for App Store compliance

### Privacy & Data Collection

- [ ] **Privacy Nutrition Labels** completed in App Store Connect:
  - [ ] Sentry crash data (if opted in): "Crash Data" under Diagnostics, linked to user? Probably "Not Linked to User" if you're not associating with user identity
  - [ ] API key storage: "Not Collected" if keys stay on-device (Keychain/safeStorage)
  - [ ] Document content: "Not Collected" if documents never leave the device (LLM calls go direct from user's device to Anthropic with their own key)
  - [ ] Usage data / analytics: declare or confirm you collect none
- [ ] **Privacy manifests** for any third-party SDKs (Apple requires these as of 2024+)
- [ ] Privacy policy URL added in App Store Connect metadata
- [ ] Privacy policy accessible within the app itself
- [ ] Privacy policy accurately describes: Sentry opt-in crash reporting, BYOK model (keys stored locally), no server-side data collection

### Export Compliance (Encryption)

- [ ] Determined encryption classification:
  - If app only uses HTTPS (via Node/Chromium built-in TLS) and OS-level encryption (safeStorage/Keychain), this qualifies as **exempt encryption**
  - [ ] Marked as "Yes, but exempt" in App Store Connect export compliance
- [ ] If using any non-exempt encryption: file for CCATS with BIS (unlikely for Prose)
- [ ] Set `ITSAppUsesNonExemptEncryption` to `false` in Info.plist to skip the compliance prompt on each submission (if exempt)

### App Store Review Readiness

- [ ] Screenshots at required resolutions (at least 1280x800 and 2560x1600 for Retina)
- [ ] App description, keywords, subtitle, and promotional text filled in
- [ ] Support URL provided
- [ ] "What's New" text for version 1.0.0
- [ ] App icon as `.icns` with full icon set AND an **Asset Catalog** (`.car` file) — electron-builder may not generate this automatically; this is a known gotcha
- [ ] **Demo/test account not needed** (BYOK means reviewer needs an Anthropic API key — provide one in review notes, or clearly explain the BYOK model and what the app does without a key)
- [ ] Review notes explaining: what the app does, that it's BYOK (user provides their own Anthropic API key), and that reMarkable/Google Docs features are intentionally hidden behind feature flags for a future release
- [ ] Tested on both Apple Silicon and Intel Macs (or confirmed Universal Binary)
- [ ] No references to "beta", "test", or placeholder content in the UI
- [ ] No broken links or dead-end screens
- [ ] App doesn't crash on first launch with no settings configured

### Feature Flags (MAS-Specific)

- [ ] reMarkable integration is fully hidden when `featureFlags.remarkable` is `false` (default)
- [ ] Google Docs integration is fully hidden when `featureFlags.googleDocs` is `false` (default)
- [ ] No traces of these features in UI, menus, settings, or help text when flags are off
- [ ] Feature-flagged code doesn't attempt network calls, OAuth flows, or filesystem access when disabled
- [ ] App Review won't stumble onto these features accidentally

### Common Rejection Reasons to Pre-Check

- [ ] No private API usage (Electron's MAS build should handle this, but verify)
- [ ] No loading remote code that changes app functionality (LLM responses that drive UI actions could be scrutinized — ensure tools/actions are clearly user-initiated)
- [ ] App provides meaningful functionality without an API key (users should be able to write, edit, and manage documents even without LLM features)
- [ ] No misleading App Store metadata (don't promise features that are behind flags)
- [ ] Minimum functionality guideline: app must not be a thin wrapper around a website

### Auto-Update

- [ ] MAS builds use Apple's built-in update mechanism (not Squirrel/electron-updater) — verify no auto-update code runs in MAS builds
- [ ] `autoUpdater` module is disabled or not imported in MAS builds

---

## 2. Electron App — Production Release

### Build & Distribution

- [ ] Production builds tested on all target platforms (macOS ARM, macOS Intel, Windows, Linux)
- [ ] **macOS (direct distribution)**: Signed with Developer ID certificate and notarized with Apple
- [ ] **macOS (MAS)**: Separate build path via `npm run build:mas` with MAS-specific signing
- [ ] **Windows**: Code-signed with EV or Azure Trusted Signing certificate (unsigned = SmartScreen warnings that will tank adoption)
- [ ] **Linux**: AppImage, .deb, and/or Snap packages as appropriate
- [ ] Verified the release workflow (`release.yml`) produces correct artifacts for each platform
- [ ] Version number is `1.0.0` everywhere: `package.json`, About dialog, any hardcoded strings

### Code Signing & Notarization (Non-MAS macOS)

- [ ] Developer ID Application certificate active and valid
- [ ] Developer ID Installer certificate (if distributing .pkg)
- [ ] Notarization succeeds (test with `xcrun notarytool` or check build logs)
- [ ] Stapled notarization ticket to the .app and .dmg
- [ ] Gatekeeper test: download the .dmg from the internet, open it, verify no scary warnings

### Hardened Runtime

- [ ] Hardened runtime enabled (required for notarization)
- [ ] Necessary exceptions declared (JIT for V8, unsigned memory access if needed)
- [ ] App still functions correctly with hardened runtime enabled

### Auto-Update (Direct Distribution)

- [ ] Auto-update mechanism tested end-to-end (Squirrel.Mac or electron-updater)
- [ ] Update feed URL configured and serving correct JSON format
- [ ] Fallback behavior if update server is unreachable (app still works, no crash)
- [ ] Code signature validation of downloaded updates
- [ ] Update channel strategy decided (stable, beta, etc.)

### Electron-Specific Security

- [ ] `contextIsolation: true` (already in your security rules)
- [ ] `nodeIntegration: false` (already in your security rules)
- [ ] `webSecurity` is not disabled in production
- [ ] No `allowRunningInsecureContent`
- [ ] CSP (Content Security Policy) headers configured for renderer
- [ ] `shell.openExternal` validates URLs (already limited to http/https in your codebase)
- [ ] Preload scripts expose minimal API surface
- [ ] No `remote` module usage (deprecated and dangerous)

### Performance & Stability

- [ ] Cold start time acceptable (< 3 seconds to interactive on modern hardware)
- [ ] Memory usage reasonable after extended use (no leaks from editor, chat, or stores)
- [ ] Large document handling tested (50+ page documents)
- [ ] Graceful behavior when Anthropic API is unreachable
- [ ] LevelDB lock conflicts handled (your troubleshooting docs mention this)
- [ ] IndexedDB schema migration tested (fresh install AND upgrade from any prior version)

### Sentry Configuration (Production)

- [ ] Production Sentry DSN is correct and receiving events
- [ ] Source maps uploaded to Sentry for this release version (via `@sentry/vite-plugin`)
- [ ] Release version tag in Sentry matches the app version
- [ ] Verified Sentry is disabled by default (opt-in only)
- [ ] Dev mode sends no events to production Sentry project
- [ ] Sentry doesn't capture API keys, document content, or PII in breadcrumbs/context
- [ ] Tested the opt-in/opt-out toggle works correctly in production builds

---

## 3. BYOK (Bring Your Own Key) App

### Key Storage & Security

- [ ] API keys stored via `safeStorage` / OS Keychain (already implemented via `credentialStore`)
- [ ] Keys are never written to plaintext files, localStorage, or IndexedDB
- [ ] If `safeStorage` is unavailable, keys are stripped and not saved (already in your security rules)
- [ ] Keys never appear in log files, Sentry reports, console output, or crash dumps
- [ ] Keys never leave the device — API calls go directly from main process to Anthropic (no proxy server)
- [ ] Keys are not included in IPC messages between main and renderer (renderer never sees the raw key)

### User Experience

- [ ] Clear onboarding flow explaining: what an API key is, where to get one (link to Anthropic console), and that the key stays on their device
- [ ] API key test/validation before saving (your `settings:testApiKey` IPC handler)
- [ ] Clear error messages when: key is invalid, key has insufficient permissions, key has been revoked, rate limit hit, billing issue on user's Anthropic account
- [ ] Easy way to update or remove the API key
- [ ] App is fully functional for writing/editing without an API key (LLM features gracefully degrade)
- [ ] No confusion about who is being billed — make it clear the user pays Anthropic directly

### Transparency & Trust

- [ ] Documentation or in-app explanation of the BYOK model
- [ ] Privacy policy explicitly states: "Your API key is stored locally using your operating system's secure credential storage. It is never transmitted to our servers."
- [ ] No telemetry or analytics that could inadvertently capture key material
- [ ] If Sentry is enabled, verified that API keys are scrubbed from any error context
- [ ] Open source codebase (see section 4) allows users to verify these claims

### API Key Lifecycle

- [ ] Key rotation: user can change their key at any time
- [ ] Key deletion: user can remove their key, and it's actually purged from Keychain
- [ ] Multiple keys: if supporting multiple providers in the future, architecture supports it (though 1.0.0 is Anthropic-only)
- [ ] Session handling: what happens if the key becomes invalid mid-session? (graceful error, not crash)

### Cost Transparency

- [ ] Users understand that LLM usage incurs costs on their Anthropic account
- [ ] Consider showing token usage or estimated cost per interaction (nice-to-have, not blocking)
- [ ] Link to Anthropic's pricing page in settings or onboarding
- [ ] Streaming responses can be aborted to avoid unnecessary token usage (your `llm:stream:abort` handler)

### Legal Considerations

- [ ] Terms of service cover: you provide the software, user provides the API key, you are not responsible for their API usage costs
- [ ] No guarantees about API availability (Anthropic's uptime is not your SLA)
- [ ] Compliance with Anthropic's usage policies (your app doesn't enable prohibited uses)
- [ ] BYOK model means you likely don't need a BAA or data processing agreement for user content (it goes directly to Anthropic under the user's own relationship)

---

## 4. Open Source Project Launch

### Repository Hygiene

- [ ] **Secrets scan the entire git history** — use `trufflehog`, `gitleaks`, or `detect-secrets` to find any accidentally committed API keys, tokens, passwords, or credentials across all branches and all time
- [ ] Sentry DSN in source: acceptable (DSNs are designed to be public — they only allow sending events, not reading data). But confirm it's a separate project from any internal/private Sentry project
- [ ] No hardcoded test API keys, internal URLs, or developer-specific paths
- [ ] `.gitignore` covers: `.env`, `*.pem`, credentials files, OS files (`.DS_Store`), build output
- [ ] No proprietary assets (fonts, icons, images) that aren't properly licensed for redistribution
- [ ] IBM Plex Mono font: SIL Open Font License — fine for open source distribution

### License

- [ ] License chosen and `LICENSE` file in repo root
- [ ] Recommendation: **Apache 2.0** — provides explicit patent grant (protects contributors), requires modification notices, well-understood by enterprises. Better than MIT for a full application (as opposed to a library)
- [ ] All source files have license headers (or rely on root LICENSE file — either convention is fine, be consistent)
- [ ] Third-party license compliance: all dependencies' licenses are compatible (run `license-checker` or `licensee` against `node_modules`)
- [ ] No GPL-licensed dependencies that would force copyleft on the entire project (or if so, acknowledge and comply)

### Documentation

- [ ] `README.md` covers: what Prose is, screenshots/demo, installation instructions, how to build from source, BYOK explanation, link to MAS listing
- [ ] `CONTRIBUTING.md` with: how to set up the dev environment, coding standards, PR process, branch naming convention, issue labeling
- [ ] `CODE_OF_CONDUCT.md` (Contributor Covenant is the standard)
- [ ] `SECURITY.md` with: how to report vulnerabilities (email, not public issue), response time expectations, scope of what's considered a vulnerability
- [ ] `CHANGELOG.md` for 1.0.0 (or use GitHub Releases for changelog)
- [ ] Existing `docs/` folder: review for internal-only content that shouldn't be public

### Repository Setup

- [ ] Branch protection on `main`: require PR reviews, require status checks, no force push
- [ ] Issue templates: bug report, feature request (with labels)
- [ ] PR template with checklist
- [ ] GitHub Actions workflows reviewed: no secrets exposed in logs, workflows don't run untrusted code from forks without approval
- [ ] `CODEOWNERS` file if you want automatic review assignment
- [ ] GitHub Discussions enabled (for community Q&A vs. issues for bugs)
- [ ] Labels organized: `bug`, `enhancement`, `good first issue`, `help wanted`, `documentation`

### CI/CD for Open Source

- [ ] CI runs on PRs from forks (but with appropriate permissions — forks shouldn't have access to secrets)
- [ ] `claude.yml` workflow: does it run on fork PRs? Does it expose your Anthropic API key? Review carefully.
- [ ] Build workflow passes on a clean clone (no hidden dependencies on local state)
- [ ] Artifact publishing: GitHub Releases with pre-built binaries for each platform

### Security for Open Source

- [ ] GitHub secret scanning enabled on the repository
- [ ] Dependabot or Renovate configured for dependency updates
- [ ] No internal infrastructure references (server URLs, deployment targets, private registries)
- [ ] MAS-specific signing certificates and provisioning profiles are NOT in the repo (stored in CI secrets only)
- [ ] `~/.prose/settings.json` path is documented but the file itself is in `.gitignore`
- [ ] Sentry auth token is in CI environment, not in code

### Community Readiness

- [ ] At least two maintainers with admin access (bus factor > 1)
- [ ] Decide on governance model: BDFL, small maintainer team, or open governance
- [ ] Triage process defined: how quickly will you respond to issues? Set expectations in README
- [ ] "Good first issue" labels on a few accessible issues to attract contributors
- [ ] Decision on whether to accept external feature PRs or keep the roadmap closed
- [ ] Communication channel chosen: GitHub Discussions, Discord, or similar

### Dual-Build Considerations (MAS + OSS)

- [ ] Build instructions clearly explain: OSS build (direct distribution, `npm run build:mac`) vs MAS build (`npm run build:mas` requires Apple Developer certs)
- [ ] Contributors can build and run the app without Apple Developer Program membership
- [ ] MAS-specific entitlements files are in the repo (they're not secret) but documented as MAS-only
- [ ] Feature flags documented: contributors understand that reMarkable and Google Docs are gated for 1.0.0

### Pre-Public Checklist

- [ ] README doesn't reference private infrastructure, internal Slack channels, or non-public URLs
- [ ] All TODO/FIXME/HACK comments reviewed — remove any that reference internal context
- [ ] Git history doesn't contain embarrassing commit messages (this is less critical but worth a glance)
- [ ] Verify the project builds and runs from a completely clean clone in a fresh environment (Docker or a fresh VM)

---

## Cross-Cutting Concerns

### Sentry Across All Builds

- [ ] MAS build: native crash reporting disabled (auto-handled by Sentry), JS error reporting works under sandbox
- [ ] Direct distribution build: full Sentry functionality including native crashes
- [ ] Open source: DSN is public-safe, but consider whether you want to receive crash reports from self-built versions (you probably do — more signal is better)
- [ ] Privacy nutrition label accurately reflects Sentry's data collection when opt-in is enabled
- [ ] Sentry `beforeSend` hook scrubs any PII, API keys, or document content from events

### Feature Flags Across All Builds

- [ ] Both MAS and direct builds respect the same feature flag defaults (`false` for reMarkable and Google Docs)
- [ ] Feature-flagged UI is completely absent (not just disabled/grayed out) when flags are off
- [ ] Open source contributors can enable flags locally for development and testing
- [ ] Documentation explains the flag system and what each flag controls

### Legal Across All Distribution Channels

- [ ] Privacy policy (single document covering all distribution methods)
- [ ] Terms of service / EULA (MAS may use Apple's Standard License Agreement or your own)
- [ ] Third-party notices / open source attribution page (in-app or in docs)
- [ ] Anthropic trademark usage: verify you're allowed to mention "Claude" and "Anthropic" in your app and marketing (check Anthropic's brand guidelines)

---

## Launch Day

- [ ] MAS build uploaded via Transporter and submitted for review (allow 1–7 days for first review)
- [ ] Direct distribution .dmg available on GitHub Releases
- [ ] Repository set to public
- [ ] Announce on relevant channels (Hacker News, Twitter/X, relevant communities)
- [ ] Monitor Sentry for first-hour crash reports
- [ ] Monitor GitHub Issues for first community reports
- [ ] Have a hotfix plan ready (how quickly can you push a 1.0.1?)

---

## Sources

- [Electron Mac App Store Submission Guide](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)
- [Electron Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Apple: Complying with Encryption Export Regulations](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)
- [Apple: App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple: App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Sentry Electron Native Crash Reporting](https://docs.sentry.io/platforms/javascript/guides/electron/features/native-crash-reporting/)
- [GitHub Open Source Guides: Starting a Project](https://opensource.guide/starting-a-project/)
- [Linux Foundation: Starting an Open Source Project](https://www.linuxfoundation.org/resources/open-source-guides/starting-an-open-source-project)
- [TruffleHog — Git Secret Scanner](https://github.com/trufflesecurity/trufflehog)
- [BYOK Tools Guide (Rilna)](https://www.rilna.net/blog/bring-your-own-api-key-byok-tools-guide-examples)
- [Apache 2.0 License Overview (FOSSA)](https://fossa.com/blog/open-source-licenses-101-apache-license-2-0/)
- [Electron Auto-Update Documentation](https://www.electronjs.org/docs/latest/tutorial/updates)
- [DoltHub: How to Submit an Electron App to MAS](https://www.dolthub.com/blog/2024-10-02-how-to-submit-an-electron-app-to-mac-app-store/)
