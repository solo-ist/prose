# Wave 0.5 — MAS Refresh (release checklist)

**Status:** Active · **Created:** 2026-06-01 · **Owner:** local HITL
**Roadmap:** [`../roadmap.md`](../roadmap.md) (Wave 0.5 · *Do Next*) · **Board:** [#5](https://github.com/orgs/solo-ist/projects/5/views/1)

The next Mac App Store release. Bundles Wave 0's shipped QoL/feature work (v1.5.0 + v1.6.0 + v1.6.1)
with the rebrand, drop-to-free pricing, and MAS hardening so the App Store build lands
**fixes + new branding + free pricing together**. Per the Distribution & Monetization Model,
**MAS is the free taste** — never the paid surface.

---

## Hard boundaries (read before touching build config)

- **Never submit for App Store review.** Upload to **App Store Connect / TestFlight** is the
  automation edge; clicking "Submit for Review" is always a human decision and action.
- **`buildVersion` is global-monotonic.** Currently `"29"` in `electron-builder.yml`.
  Every upload to App Store Connect must use a strictly higher integer than any prior upload —
  **never reset it** when bumping the marketing version (`package.json` `version`, currently `1.6.2`).
- **Never change sandbox flags** (`contextIsolation: true`, `nodeIntegration: false`) or the MAS
  entitlements without re-validating against the provisioning profile.
- The `mas` target force-disables reMarkable (credentials/OCR not App-Store-ready) and blocks
  MCP install/uninstall/status via `IS_MAS_BUILD` — expected, don't "fix" it.

---

## Sequenced work

Ordered by the roadmap's sequencing: unblock local QA → harden → cheap config/asset/copy bulk.

### 0. Critical path — restore local MAS QA
- [ ] **#487** — `masDev` local launch fails (Launchd 163). Local MAS-sandbox QA is broken;
      verification otherwise falls back to the slow (~15-min) TestFlight upload loop.
      **Debug this first.** See the investigation log below. If it proves intractable in a
      time-box, fall back to TestFlight-only verification and note that decision here.

### 1. MAS hardening (real code/config risk)
- [ ] **#391** — Sentry CSP blocks the `sentry-ipc` protocol in the MAS build. Land crash
      reporting on the free client. Touches CSP + Sentry init; verify Sentry stays **opt-in**.
- [ ] **#376** — Enable asar integrity fuses in production builds. Hardens the self-distributed
      DMG/ZIP too, not just MAS. Verify the app still launches signed after fuse flip.

### 2. The cheap bulk (config / assets / copy)
- [ ] **#615** — Drop the $0.99 price → ship free. App Store Connect pricing change +
      any in-repo references. Low code risk.
- [ ] **#612** — Refresh App Store screenshots + icon for the new branding.
- [ ] **#613** — Refresh App Store description + persona copy. Current `docs/app-store-copy.md`
      is **stale** ("First release" promo text, pre-rebrand) — rewrite it.

### 3. Deprioritized (revisit only if needed)
- [ ] **#409** — MAS universal binary (arm64 + x64). Revisit only if Intel demand shows.
- [ ] **#317** — Agent-driven macOS UI testing via Circuit + GitHub Actions (test infra).

---

## #487 investigation log

Symptom: `electron-builder --mac mas-dev` → dev-signed `dist/mas-dev-arm64/Prose.app`
fails to launch with `RBSRequestErrorDomain Code=5` / `NSPOSIXErrorDomain Code=163`
("Launchd job spawn failed") on macOS 15.3 / Darwin 25.3.

Already tried (no effect): installing the dev provisioning profile, removing
`com.apple.provenance` xattrs, copying to `/tmp/`, direct binary launch, `log show` (no AMFI/
sandbox/launchd denial surfaced). Production `mas` target also won't launch locally (expected —
bound to the App Store install flow).

Leads to chase (from the issue): dev cert in System vs login keychain · register profile via
Xcode "Download Manual Profiles" · exact `com.apple.security.app-group` match
(`8PT2Y7QQ2F.ist.solo.prose`) · recent macOS/Xcode policy change for locally-launched
MAS-sandboxed dev builds.

### Root cause (corrected 2026-06-01 — provisioning/device gap, NOT a cert problem)

> An earlier pass misdiagnosed this as a missing/cross-team cert. The valid Apple Development
> cert's CN is `Apple Development: ANGEL MARINO (2Y3M2V2Q5F)`, and the parenthetical `(2Y3M2V2Q5F)`
> was misread as the team. It isn't — in an Apple Development cert the CN parenthetical is a
> *per-developer* identifier; **the team is the cert's `OU`.** (h/t Claude Cowork for the catch.)

Verified against the keychain (`openssl x509 -subject` on the exported certs):

```
# valid — OU is the MAS team
C=US, O=ANGEL MARINO, OU=8PT2Y7QQ2F, CN=Apple Development: ANGEL MARINO (2Y3M2V2Q5F), UID=HX2XHG7583   notAfter=2027-03-18
# expired — parenthetical ≠ OU
C=US, O=Angel Marino, OU=PDU38J9F73, CN=Apple Development: Angel Marino (2R28G5K25U), UID=9T728L4SV8   notAfter=2025-01-09
```

The valid Apple Development cert is **already under team `8PT2Y7QQ2F`** (good through 2027-03-18) —
there is no cross-team cert. Error 163 is downstream of the cert: most likely a **stale or missing
development provisioning profile** (built against the expired `2R28G5K25U`/`PDU38J9F73` cert, or not
listing this Mac), or this Mac not being registered under `8PT2Y7QQ2F`. A dev profile can't
authorize an unlisted device. (This is consistent with MAS *release* already working — release
signs via the Distribution chain, never implicated here.)

Environment note: machine is now **macOS 26.3 (25D125)** on **Apple M4 Pro**; Provisioning UDID
**`00006040-0004482A0187801C`**. (Issue was filed on macOS 15.3.)

### Fix — provisioning, not code (human-gated; needs the `8PT2Y7QQ2F` Apple ID)

1. ~~Mint an `Apple Development` cert under `8PT2Y7QQ2F`~~ — **not needed; already exists**
   (`OU=8PT2Y7QQ2F`, valid through 2027-03-18).
2. **Confirm this Mac is registered under `8PT2Y7QQ2F`.** Portal → Devices → Platform macOS →
   Provisioning UDID `00006040-0004482A0187801C` (or let Xcode auto-register on first build).
3. **Regenerate `build/Prose_Development.provisionprofile`** for app ID `ist.solo.prose` under
   `8PT2Y7QQ2F`, embedding the existing `8PT2Y7QQ2F` dev cert, this Mac, and the **App Groups**
   capability (`8PT2Y7QQ2F.ist.solo.prose`).
4. **(Optional / defensive) Pin `masDev.identity`** to the existing cert's SHA-1
   (`5106DA8B43E1AF25E3B553CABD91400445A9E68A`). With only one *valid* Apple Development cert
   present, bare `Apple Development` already resolves to it — hygiene, not a fix.
5. **Rebuild + verify:** `npx electron-builder --mac mas-dev` → launch `dist/mas-dev-arm64/Prose.app`.
   Expect a clean launch and working file-open/bookmark persistence under real sandbox enforcement.

Most likely root cause: a stale or missing development provisioning profile, not the certificate.
Fallback if blocked: TestFlight-only verification (the issue's documented workaround).

---

## Build & upload runbook

```bash
# 1. Bump marketing version if cutting a new one (package.json "version"); DO NOT touch buildVersion
#    unless incrementing it for a fresh upload (electron-builder.yml "buildVersion", monotonic).

# 2. Build the App Store package
npm run build:mas            # MAS_BUILD=1 npm run build && electron-builder --mac mas
                             # → dist/mas-arm64/Prose-<version>.pkg

# 3. Build the dev target for local sandbox QA (the thing #487 currently breaks)
npx electron-builder --mac mas-dev   # → dist/mas-dev-arm64/Prose.app

# 4. Upload to App Store Connect / TestFlight (upload is the automation boundary — review
#    submission is always a human action)
#    NOTE: Apple has deprecated `altool` for App Store delivery — use the Transporter app or
#    `xcrun iTMSTransporter` (resolves to Transporter.app's binary when installed; verified
#    working for v1.6.1 build 23 on 2026-06-03). Supply the Key ID + Issuer UUID via env
#    (never hardcode them); the .p8 private key lives under ~/.appstoreconnect/private_keys/
#    (a default iTMSTransporter lookup path).
#    NOTE: the artifact name includes the arch: dist/mas-arm64/Prose-<version>-arm64.pkg
xcrun iTMSTransporter -m upload \
  -assetFile dist/mas-arm64/Prose-<version>-arm64.pkg \
  -apiKey "$ASC_KEY_ID" \
  -apiIssuer "$ASC_ISSUER_ID"
```

The notarized DMG/ZIP for the **self-distributed** channel ship separately via `release.yml`
on a `v*` tag (already published through **v1.6.1**, the current latest release).

---

## Pre-submission gate (all human-confirmed)

- [x] `buildVersion` incremented above the last App Store Connect upload.
      *(23 > 22; v1.6.1 build 23 uploaded to App Store Connect 2026-06-03 via `xcrun iTMSTransporter`.)*
- [x] reMarkable + MCP correctly gated out of the MAS build (`IS_MAS_BUILD`).
      *(Build ran with `MAS_BUILD=1`; gating is compile-time via `src/main/env.ts`. Spot-check on TestFlight.)*
- [ ] Sentry opt-in still defaults off; `sentry-ipc` works in MAS (#391). *(Code merged in v1.6.1; verify on the TestFlight install.)*
- [ ] App launches signed with asar fuses enabled (#376). *(Fuses verified on the Developer-ID smoke test; the MAS target intentionally skips fuse flipping — sandbox provides equivalent protection. Verify launch on TestFlight.)*
- [ ] Pricing set to free in App Store Connect (#615).
- [ ] New screenshots + icon + description uploaded (#612, #613).
- [ ] App Privacy label updated: declare **optional Crash Data (not linked to identity)** now that opt-in Sentry works on MAS (#391) — no longer "Data Not Collected."
- [ ] TestFlight build verified on a real install (covers what #487's local loop can't).
- [ ] **STOP** — submission for review is a human action.
