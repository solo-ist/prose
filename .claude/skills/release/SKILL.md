---
name: release
description: Create a new Prose release with automated testing, GitHub release, and local verification.
---

# Release

Automates the full release workflow for Prose including regression testing, version management, release notes, GitHub release creation, and local installation verification.

## Usage

```
/release [version]
```

If version is omitted, the current version is shown and you'll be prompted to select the next version.

## Workflow

### 1. Pre-flight Checks

Verify clean state before proceeding:

```bash
# Must be on main branch
git branch --show-current

# Working tree must be clean (untracked files OK, uncommitted changes not OK)
git status --porcelain | grep -v "^??" | wc -l

# Current version
node -p "require('./package.json').version"

# Last release tag
git tag --list 'v*' --sort=-v:refname | head -1

# Commits since last release
git log $(git tag --list 'v*' --sort=-v:refname | head -1)..HEAD --oneline
```

**Requirements:**
- Must be on `main` branch
- No uncommitted changes (staged or unstaged)
- At least one commit since last release

If pre-flight fails, report what needs to be fixed and stop.

### 2. Version Bump

**Parse current version** to suggest next:
- `0.1.0-alpha.1` → suggest `0.1.0-alpha.2` (next prerelease)
- `0.1.0-alpha.N` → can also offer `0.1.0-beta.1` or `0.1.0` (stable)
- `0.1.0` → suggest `0.1.1` (patch), `0.2.0` (minor), `1.0.0` (major)

**Ask user** which version using AskUserQuestion with options:
- Next prerelease (e.g., `0.1.0-alpha.2`)
- Next beta (e.g., `0.1.0-beta.1`) — if currently alpha
- Stable release (e.g., `0.1.0`) — if currently prerelease
- Custom version (Other option)

**Update package.json:**

```bash
npm version <version> --no-git-tag-version
```

**Commit version bump:**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to <version>"
```

### 3. Build

Kill stale processes and build:

```bash
# Kill stale Electron/Vite processes
pkill -f "Electron.app" 2>/dev/null || true
pkill -f "electron-vite" 2>/dev/null || true

# Build macOS distributable
npm run build:mac
```

**Verify DMG created:**

```bash
ls -la dist/Prose-*-arm64.dmg
```

The DMG should be at `dist/Prose-<version>-arm64.dmg`.

### 4. Regression Testing (Circuit Electron)

Run medium-depth smoke tests to verify the build works. Load Circuit Electron tools first:

```
ToolSearch: select:mcp__circuit-electron__app_launch
```

#### 4.1 Launch Built App

Launch the packaged app (not dev mode):

```
mcp__circuit-electron__app_launch (
  app: "/Users/angelmarino/Code/prose/dist/mac-arm64/Prose.app/Contents/MacOS/Prose",
  mode: "packaged",
  includeSnapshots: false
)
```

Save the returned `sessionId` for subsequent commands.

#### 4.2 Verify App Opens

```
mcp__circuit-electron__screenshot (sessionId: <id>)
```

Take screenshot to confirm app launched successfully. Verify:
- Editor area is visible
- Sidebar is visible
- No error dialogs

#### 4.3 Test Editor Functionality

Type content into editor:

```
mcp__circuit-electron__evaluate (sessionId: <id>, script: `
  const editor = document.querySelector('.ProseMirror');
  if (editor) {
    editor.innerHTML = '<p>Release test content - ' + new Date().toISOString() + '</p>';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
  editor?.innerText
`)
```

Verify content appears in editor.

#### 4.4 Test Settings Dialog

Open settings (Cmd+,):

```
mcp__circuit-electron__evaluate (sessionId: <id>, script: `
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }));
  'triggered'
`)
```

Wait briefly, then verify settings dialog opened:

```
mcp__circuit-electron__evaluate (sessionId: <id>, script: `
  document.querySelector('[role="dialog"]')?.innerText || 'no dialog'
`)
```

Close settings:

```
mcp__circuit-electron__evaluate (sessionId: <id>, script: `
  document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click() ||
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  'closed'
`)
```

#### 4.5 Verify Version in About Dialog

Open About dialog (Prose → About Prose menu, or via evaluate):

```
mcp__circuit-electron__evaluate (sessionId: <id>, script: `
  // Trigger About dialog via IPC if possible, otherwise look for menu
  window.api?.showAboutDialog?.() || 'no direct access';
`)
```

Since menu access may be limited, ask user to manually verify:

**Manual verification:** Open Prose menu → About Prose and confirm version shows `<version>`.

#### 4.6 Clean Up

```
mcp__circuit-electron__close (sessionId: <id>)
```

**Test summary:** Report pass/fail for each test:
- App launch: PASS/FAIL
- Editor functionality: PASS/FAIL
- Settings dialog: PASS/FAIL
- Version (manual): NEEDS VERIFICATION

If any automated tests fail, stop and report issues.

### 5. Release Notes

Update `RELEASE_NOTES.md` with the new version info. Use this template:

```markdown
# Prose v<version> — <tagline>

<One sentence description of this release.>

## What's New

- <Feature or fix from commits since last release>
- <Another change>

## Requirements

- **macOS** (Apple Silicon) — Intel Mac support coming soon
- **Anthropic API key** — Required for AI features ([get one here](https://console.anthropic.com/))

## Installation

1. Download `Prose-<version>-arm64.dmg`
2. Open the DMG and drag Prose to Applications
3. **Important: Unsigned app workaround**

   macOS will show a misleading "damaged" error for unsigned apps downloaded from the internet. The app is not actually damaged. To fix this, open Terminal and run:

   ```bash
   xattr -cr /Applications/Prose.app
   ```

   Then open Prose normally. This is only required once after installation.

## Known Limitations

This is an early alpha release:

- macOS only (Windows/Linux builds coming)
- Apple Silicon only (Intel support coming)
- App is unsigned — requires manual security bypass
- No auto-updates yet

## Feedback

Found a bug or have a suggestion? Please open an issue:
https://github.com/angelmarino/prose/issues

---

Built with Electron, React, and TipTap.
```

**Generate "What's New" section** from commits since last release:

```bash
git log $(git tag --list 'v*' --sort=-v:refname | head -1)..HEAD --oneline --no-merges
```

Group changes by type (feat, fix, etc.) and write human-readable descriptions.

### 6. Create GitHub Release

Create the release with the DMG attached:

```bash
# Determine if prerelease (alpha, beta, rc)
VERSION="<version>"
PRERELEASE_FLAG=""
if [[ "$VERSION" == *"alpha"* ]] || [[ "$VERSION" == *"beta"* ]] || [[ "$VERSION" == *"rc"* ]]; then
  PRERELEASE_FLAG="--prerelease"
fi

# Create release
gh release create "v${VERSION}" \
  --title "Prose v${VERSION}" \
  --notes-file RELEASE_NOTES.md \
  $PRERELEASE_FLAG \
  "dist/Prose-${VERSION}-arm64.dmg"
```

Verify release was created:

```bash
gh release view "v<version>"
```

### 7. Local Installation Verification

Download and install the release to verify the full user experience:

```bash
# Create temp directory for download
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

# Download DMG from GitHub release
gh release download "v<version>" --pattern "*.dmg"

# Mount DMG
hdiutil attach Prose-*-arm64.dmg

# Copy to Applications (will overwrite existing)
rm -rf /Applications/Prose.app
cp -R /Volumes/Prose/Prose.app /Applications/

# Unmount DMG
hdiutil detach /Volumes/Prose

# Run xattr fix
xattr -cr /Applications/Prose.app

# Clean up temp
cd -
rm -rf "$TEMP_DIR"
```

Launch installed app and verify:

```bash
open /Applications/Prose.app
```

**Manual verification:**
1. App launches without Gatekeeper errors
2. About dialog shows correct version
3. Basic editing works

Close the app after verification.

### 8. Push and Cleanup

Push the version commit:

```bash
git push origin main
```

Push the tag (created by gh release):

```bash
git push origin "v<version>"
```

**Optional:** If this release closes any issues, close them:

```bash
gh issue close <issue-number> --comment "Released in v<version>"
```

## Summary Report

At the end, provide a summary:

```
## Release v<version> Complete

### Artifacts
- GitHub Release: https://github.com/angelmarino/prose/releases/tag/v<version>
- DMG: Prose-<version>-arm64.dmg (<size>)

### Tests
- App launch: PASS
- Editor functionality: PASS
- Settings dialog: PASS
- Local install: PASS

### Next Steps
- [ ] Announce release (if desired)
- [ ] Close related issues
```

## Troubleshooting

### Build Fails

```bash
# Clean and rebuild
rm -rf out dist node_modules/.cache
npm run build:mac
```

### Circuit Electron Issues

- **App won't launch**: Verify path to executable is correct
- **Snapshot errors**: Always use `includeSnapshots: false`
- **"Not connected"**: Circuit Electron MCP may have disconnected, try reloading

### GitHub Release Fails

```bash
# Check authentication
gh auth status

# Verify DMG exists
ls -la dist/*.dmg
```

### Local Install Fails

- **"App is damaged"**: Run `xattr -cr /Applications/Prose.app`
- **Already running**: Close existing Prose instances first
- **Permission denied**: May need `sudo` for `/Applications` write
