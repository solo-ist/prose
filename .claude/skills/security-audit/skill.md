---
name: security-audit
description: Systematic security audit for Electron apps. Scans attack surfaces, produces severity-tagged findings, generates implementation plan, and guides hardening.
---

# Security Audit

Systematic security audit for Electron desktop applications. Identifies vulnerabilities across the privilege boundary, produces a prioritized findings table, and generates an actionable implementation plan.

## Usage

```
/security-audit [scope]
```

**Scope** (optional): Focus the audit on a specific area instead of running the full checklist.
- `full` (default) — all categories
- `urls` — URL validation surfaces
- `electron` — Electron security handlers
- `ipc` — IPC and MCP authentication
- `csp` — Content Security Policy
- `credentials` — Credential storage and OAuth
- `build` — Build pipeline hardening (fuses, signing)

## Philosophy

**Defense in depth.** Layer protections so no single bypass is catastrophic:
- Validate at every trust boundary (main process, preload, renderer)
- Prefer deny-by-default over allowlisting
- Fix the highest-impact, lowest-effort issues first
- Don't over-engineer — match security investment to actual threat model

**Pragmatism over paranoia.** Not every theoretical attack justifies a fix:
- Localhost-only timing side-channels are low priority
- Session timeouts on local Unix sockets add complexity for minimal gain
- But cross-platform path bugs that silently bypass auth are critical

## Workflow

### Phase 1: Reconnaissance

Read the codebase to understand the architecture before auditing.

**Files to read first:**
- `CLAUDE.md` — project architecture overview
- `src/main/index.ts` — main process entry (window creation, protocol handlers, CSP)
- `src/preload/index.ts` — context bridge surface
- `src/main/ipc.ts` — IPC handler definitions
- `electron-builder.yml` — build configuration
- `package.json` — dependencies and Electron version

**Questions to answer:**
1. What is the Electron version? (Check for known CVEs)
2. Is `sandbox` enabled? Is `contextIsolation` enabled? Is `nodeIntegration` disabled?
3. What custom protocols are registered?
4. What IPC channels exist and what do they accept?
5. Are there any HTTP/WebSocket servers running in the main process?
6. How are credentials stored?
7. What CSP is configured?

### Phase 2: Audit Checklist

Run through each category systematically. For each finding, record:
- **ID**: Sequential identifier (H1, M1, etc.)
- **Severity**: HIGH, MEDIUM, LOW, INFO
- **Finding**: What the vulnerability is
- **Location**: File and line number
- **Category**: Which group it belongs to

#### Category 1: URL Validation Surfaces

Untrusted URLs can execute arbitrary code via `javascript:`, `data:`, or custom schemes.

**Check each surface:**

| Surface | What to look for |
|---------|-----------------|
| `setWindowOpenHandler` | Does it call `shell.openExternal` without scheme validation? |
| `will-navigate` handler | Does one exist? Does it restrict to expected origins? |
| Link click handlers | Do CMD+Click or renderer link handlers validate schemes? |
| LLM-generated content | Are links from AI responses rendered with href validation? |
| `shell.openExternal` IPC | Is the IPC handler validating schemes before calling? |

**Safe pattern:**
```typescript
const parsed = new URL(url)
if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
  return // block
}
```

**Pitfall:** `new URL('file:///etc/passwd').origin` returns `'null'` (string) per URL spec. If comparing origins for `file://` URLs, check `parsed.protocol` explicitly.

#### Category 2: Electron Security Handlers

Missing handlers leave implicit defaults that are usually permissive.

| Handler | Purpose | Correct behavior |
|---------|---------|-----------------|
| `will-navigate` | Block navigation to untrusted origins | Allow only app origin (`file://` prod, Vite dev server in dev) |
| `setPermissionRequestHandler` | Control permission grants | Deny all (unless app genuinely needs camera/mic/geo) |
| `certificate-error` | Handle invalid TLS certs | Always `callback(false)` — never trust bad certs |
| `setWindowOpenHandler` | Control `window.open()` | Deny action, optionally open in external browser |

**Pitfall:** `certificate-error` requires both `event.preventDefault()` AND `callback(false)`. Missing either one uses the default behavior.

#### Category 3: IPC & Local Server Authentication

Any HTTP/WebSocket/Unix socket server in the main process is accessible to all local processes.

**Check:**
- Is there an HTTP server? Does it require authentication?
- Is there a Unix socket? Does it require authentication?
- How is the auth token generated, stored, and transmitted?
- Is the token comparison constant-time (`crypto.timingSafeEqual`)?
- Is the token file restricted to the owning user (`mode: 0o600`)?
- Is token cleanup attempted on quit?

**Auth token lifecycle pattern:**
```
startup → randomBytes(32) → write to file (0o600) → pass to servers → cleanup on will-quit
```

**Pitfalls:**
- **Race condition:** If a client (e.g., stdio bridge) sends requests before auth handshake completes, the server may reject them. Wait for auth response before resolving the connection promise.
- **Cross-platform paths:** `app.getPath('userData')` resolves differently per platform. Hardcoding `~/Library/Application Support/AppName` breaks on Linux/Windows and silently bypasses auth.
- **Token-before-start ordering:** Set the auth token before calling `server.start()`, or enforce it structurally with a guard in `start()`.

**Cross-platform userData paths:**
```typescript
function getUserDataPath(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'AppName')
    case 'win32':
      return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'AppName')
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'AppName')
  }
}
```

#### Category 4: Custom Protocols & CSP

Custom protocol handlers (`protocol.handle`) can serve arbitrary filesystem content.

**Check:**
- What files can the protocol serve? Is it confined to a safe directory?
- Does path normalization prevent traversal (`../../../etc/passwd`)?
- Is CSP `connect-src` limited to actually-used API endpoints?
- Does CSP `img-src` allow `https:` wildcard? (Enables tracking pixels but needed for remote images in documents)
- Is `style-src 'unsafe-inline'` present? (Often required by editor frameworks like TipTap/ProseMirror)

**Safe confinement pattern:**
```typescript
const normalized = normalize(filePath)
if (!normalized.startsWith(homedir() + sep)) {
  return new Response('Access denied', { status: 403 })
}
```

#### Category 5: Credential Storage & OAuth

**Check:**
- Are credentials stored via `safeStorage` / a credential store abstraction?
- Are there any plaintext credentials on disk?
- Does the OAuth flow include a CSRF `state` parameter?
- Are credential migration paths consistent (no duplicated logic)?
- Is `.mcp.json` or similar config with secrets in `.gitignore`?

**CSRF state pattern for OAuth:**
```typescript
const csrfState = randomBytes(16).toString('hex')
const authUrl = oauth2Client.generateAuthUrl({ state: csrfState })
// In callback:
if (url.searchParams.get('state') !== csrfState) { reject('CSRF') }
```

**Pitfall:** Duplicated migration logic across multiple files. Extract a shared `migrateFromLegacyFile(legacyPath, credentialKey)` helper.

#### Category 6: Build Pipeline Hardening

**Check:**
- Are Electron fuses configured to disable dangerous runtime features?
- Is code signing configured? (Distribution concern, may be out of scope)
- Are `devDependencies` properly separated from `dependencies`?

**Fuses to disable in production:**
```javascript
// build/afterPack.js
const { flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses')
await flipFuses(executablePath, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
})
```

Wire into `electron-builder.yml` with `afterPack: build/afterPack.js`.

### Phase 3: Findings Report

Produce a findings table sorted by severity:

```markdown
| ID | Severity | Finding | Location | Category |
|----|----------|---------|----------|----------|
| H1 | HIGH | ... | `src/main/index.ts:147` | URL Validation |
```

### Phase 4: Implementation Plan

Group findings by blast radius and dependency. Prioritize:

1. **Smallest changes, highest attacker value** (URL validation)
2. **Missing security handlers** (Electron event handlers)
3. **Protocol and CSP fixes** (pairs with handlers)
4. **IPC authentication** (most complex, touches multiple files)
5. **Credential hygiene** (mechanical but touches multiple files)
6. **Build hardening** (build pipeline only, no runtime risk)

For each group, specify:
- Files modified
- What changes
- Verification steps

### Phase 5: Verification

After implementation, verify each group:

| Group | Verification |
|-------|-------------|
| URL validation | CMD+Click `javascript:` link → nothing happens. `https://` link → opens browser. |
| Electron handlers | DevTools: `location.href = 'https://evil.com'` → blocked with console warning. |
| IPC auth | `curl http://localhost:<port>/endpoint` without token → 401. |
| Protocol confinement | `local-file:///etc/hosts` in DevTools → 403. |
| Credentials | Existing credentials survive migration. New store/retrieve works. |
| Fuses | `ELECTRON_RUN_AS_NODE=1 ./App -e "console.log('hi')"` → fails. |

## Common Mistakes

Lessons from past audits — check for these proactively:

1. **Hardcoded macOS paths in cross-platform code.** `~/Library/Application Support/` only works on macOS. Use `app.getPath('userData')` in Electron or replicate the platform logic in non-Electron code.

2. **Resolving connections before auth completes.** When adding auth handshakes to existing socket connections, the promise must resolve AFTER the auth response, not after sending the request.

3. **Non-constant-time token comparison.** Use `crypto.timingSafeEqual` for all token/secret comparisons. Requires length pre-check since `timingSafeEqual` throws on length mismatch.

4. **Dead code after adding guards.** If `start()` throws without a token, then `if (this.token)` inside the request handler is dead code. Remove it or add a comment explaining it's defense-in-depth.

5. **Forgetting to `git fetch origin` before comparing branches.** Always fetch before claiming a branch is up to date.

6. **Removing CSP entries without removing the code paths.** If you tighten `connect-src` to remove a provider URL, verify no UI path still offers that provider as an option.

7. **Credential migration duplication.** If the same "read legacy file → store in new system → delete legacy" pattern appears in multiple places, extract a helper before it diverges.

## Output Format

The skill produces three artifacts:

1. **Findings table** — all issues found, with severity, location, and category
2. **Implementation plan** — grouped, ordered, with file lists and verification
3. **Deferred items** — issues intentionally not addressed, with rationale and tracking issue references
