# Homebrew Cask — Prose

Preparation guide for distributing Prose via Homebrew. Covers both the official
`Homebrew/homebrew-cask` submission path and the interim personal tap
(`solo-ist/homebrew-prose`).

## Verification results (v1.6.4)

### Notarization

DMG itself carries no code signature (expected for Electron-style DMGs — the
notarization stamp is on the enclosed `.app` bundle, not the container):

```
$ spctl --assess --type open --context context:primary-signature -vvv \
    /tmp/Prose-1.6.4-arm64.dmg
/tmp/Prose-1.6.4-arm64.dmg: rejected
source=no usable signature
```

The enclosed `Prose.app` is notarized:

```
$ spctl --assess --verbose --type execute /tmp/prose-dmg-mount/Prose.app
/tmp/prose-dmg-mount/Prose.app: accepted
source=Notarized Developer ID
```

App bundle code signature is valid:

```
$ codesign --verify --verbose --deep /tmp/prose-dmg-mount/Prose.app
/tmp/prose-dmg-mount/Prose.app: valid on disk
/tmp/prose-dmg-mount/Prose.app: satisfies its Designated Requirement
```

**Conclusion:** the app is correctly notarized. Homebrew/Gatekeeper will accept it.

### SHA-256

```
fc8f56a7f9ef242265ddfd6e098231600c947c6882a7f0024f3435392367019f  Prose-1.6.4-arm64.dmg
```

Asset: `https://github.com/solo-ist/prose/releases/download/v1.6.4/Prose-1.6.4-arm64.dmg`

### Cask name availability

```
$ brew info --cask prose
Error: Cask 'prose' is unavailable: No Cask with this name exists.
```

**`prose` is available** in `Homebrew/homebrew-cask`. No need for the `prose-editor`
fallback — file as `prose`.

---

## Cask formula

```ruby
# Casks/p/prose.rb
cask "prose" do
  version "1.6.4"
  sha256 "fc8f56a7f9ef242265ddfd6e098231600c947c6882a7f0024f3435392367019f"

  url "https://github.com/solo-ist/prose/releases/download/v#{version}/Prose-#{version}-arm64.dmg"
  name "Prose"
  desc "Cross-platform writing app with integrated AI"
  homepage "https://solo.ist"

  app "Prose.app"

  zap trash: [
    "~/Library/Application Support/Prose",
    "~/Library/Caches/ist.solo.prose",
    "~/Library/Logs/Prose",
    "~/Library/Preferences/ist.solo.prose.plist",
    "~/Library/Saved Application State/ist.solo.prose.savedState",
  ]
end
```

**Update checklist for future releases:**
1. Change `version` to the new marketing version string.
2. Download the new arm64 DMG and recompute `sha256` (`shasum -a 256 <file>`).
3. Open a PR against `Homebrew/homebrew-cask` (official) or update the personal tap formula.

---

## Path A — Official Homebrew/homebrew-cask submission

This is the preferred long-term path. Requires a GitHub account and `brew` installed.

### Prerequisites

- `brew` installed and up to date (`brew update`)
- The release is a stable, non-pre-release GitHub Release (v1.6.4 qualifies)

### Steps

1. **Fork** `Homebrew/homebrew-cask` on GitHub.

2. **Clone your fork:**
   ```bash
   git clone https://github.com/<your-handle>/homebrew-cask.git
   cd homebrew-cask
   ```

3. **Create the cask file:**
   ```bash
   mkdir -p Casks/p
   # Paste the formula above into Casks/p/prose.rb
   ```

4. **Audit locally:**
   ```bash
   brew install --cask --build-from-source ./Casks/p/prose.rb
   brew audit --cask --new ./Casks/p/prose.rb
   brew style ./Casks/p/prose.rb
   ```
   All three must pass without errors.

5. **Commit:**
   ```bash
   git checkout -b add-prose-cask
   git add Casks/p/prose.rb
   git commit -m "Add cask for prose"
   ```
   Homebrew requires the commit message in exactly this form: `"Add cask for <cask-name>"`.

6. **Open the PR** against `Homebrew/homebrew-cask:master`. The PR title must be:
   ```
   Add cask for prose
   ```
   Fill in the PR template. CI runs `brew audit` and `brew style` automatically.

7. **Review timeline:** official cask reviews typically take a few days to a few weeks.
   Reviewers may ask for changes to the `zap` stanza or other details.

---

## Path B — Interim personal tap (solo-ist/homebrew-prose)

Lets users `brew install --cask prose` immediately via `brew tap solo-ist/prose`,
without waiting for the official review. Useful until the official cask lands.

### One-time tap setup (Angel, on GitHub)

1. **Create the repository** `solo-ist/homebrew-prose` on GitHub (public, empty).

2. In the new repo, create the directory `Casks/` and commit `Casks/prose.rb` with the
   formula above. The formula file name (`prose.rb`) must match the cask name (`prose`).
   The repo name (`homebrew-prose`) follows the Homebrew tap naming convention
   (`homebrew-<tap-name>` → accessed as `solo-ist/prose`).

3. Create a `README.md` pointing users to:
   ```bash
   brew tap solo-ist/prose
   brew install --cask prose
   ```

### User install command

```bash
brew tap solo-ist/prose
brew install --cask prose
```

### Updating the personal tap

After each release:

1. Edit `Casks/prose.rb` — bump `version` and update `sha256`.
2. Commit and push to `solo-ist/homebrew-prose`.
3. Users on the tap get the update on their next `brew upgrade`.

---

## Relationship between paths A and B

- **Ship Path B first** (personal tap) for immediate availability.
- **Submit Path A** (official cask) in parallel. Once merged, `brew install --cask prose`
  works without the `brew tap` step.
- After the official cask lands, add a deprecation notice to the personal tap README
  pointing users to uninstall the tap (`brew untap solo-ist/prose`) and reinstall via
  the official cask.

---

## Tracked in

- Issue: [#384](https://github.com/solo-ist/prose/issues/384)
- Release asset: [v1.6.4](https://github.com/solo-ist/prose/releases/tag/v1.6.4)
