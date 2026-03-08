# Security Audit Findings — Prose

**Issue:** #127
**Date:** 2026-03-07
**Auditor:** Claude Sonnet 4.6 (automated)
**Scope:** Full codebase security review — npm dependencies, Electron configuration, IPC handlers, secret management, XSS vectors

---

## Executive Summary

Prose is an Electron/React writing app that handles local files and makes API calls to Anthropic (and optionally Google). The overall security posture is solid for a desktop app: contextIsolation is enabled, nodeIntegration is disabled, file operations use a path traversal validator, API keys are stored via Electron's `safeStorage`, and external URL opening is restricted to http/https.

Three areas warrant attention before any broader distribution:

1. **The `.env` file contains live credentials** (OCR API key, Google OAuth client secret) and is not in version control — but the `.env.example` in the repo contains the real Lambda URL and a real OCR API key value. That key should be rotated.
2. **`sandbox: false`** is set on the main BrowserWindow, which weakens Electron's process isolation. This is a deliberate trade-off for preload access but should be documented and reconsidered.
3. **`file:saveToFolder` lacks path validation**, unlike every other file-writing IPC handler. A malicious filename from the renderer could write outside the intended folder.
4. **`innerHTML` is used in the AI annotation tooltip** with data from user-controlled annotation provenance fields (model name), creating a potential XSS vector within the renderer.

No hardcoded Anthropic API keys or user credentials were found in source. Gitleaks has confirmed no secrets in git history.

---

## npm Audit Summary

**10 high severity vulnerabilities, 0 critical.**

All 10 findings trace back to a single root cause: `minimatch` versions `10.0.0–10.2.2` in the `electron-builder` dependency tree.

| CVE / Advisory | Package | Severity | Description | Fix Available |
|---|---|---|---|---|
| GHSA-7r86-cg39-jmmj | minimatch | High | ReDoS via multiple non-adjacent GLOBSTAR segments (CVSS 7.5) | Yes |
| GHSA-23c5-xmqv-rm74 | minimatch | High | ReDoS via nested `*()` extglobs (CVSS 7.5) | Yes |

**Affected transitive chain:** `electron-builder` → `app-builder-lib` → `@electron/asar`, `@electron/universal`, `dir-compare`, `filelist`, `glob` → `minimatch@10.0.0–10.2.2`

**Important context:** `package.json` already has an `overrides` entry `"minimatch": "10.2.1"` which is still within the vulnerable range (fix requires `>=10.2.3`). The override is almost correct but the pinned version is too low.

**Impact:** These are build-tool dependencies only — they run at `npm run build` time, not at app runtime. A ReDoS attack would require a malicious glob pattern fed to the build tooling, which is a low-risk vector in this context. However it should still be remediated.

---

## Findings

| ID | Severity | Category | Description |
|---|---|---|---|
| SEC-01 | High | Secret Exposure | Live OCR API key in `.env.example` |
| SEC-02 | Medium | Electron Security | `sandbox: false` on main BrowserWindow |
| SEC-03 | Medium | Path Traversal | `file:saveToFolder` skips path validation |
| SEC-04 | Medium | XSS | `innerHTML` in AI annotation tooltip with unsanitized data |
| SEC-05 | Medium | Protocol Security | `local-file://` custom protocol uses `bypassCSP: true` |
| SEC-06 | Low | Dependency | minimatch ReDoS (build-time only, 10 advisories) |
| SEC-07 | Low | Secret Exposure | Plaintext API key fallback path in settings |
| SEC-08 | Low | Electron Security | HTTP MCP server uses `Access-Control-Allow-Origin: *` |
| SEC-09 | Info | Secret Scanning | No secrets found in git history (gitleaks passed) |
| SEC-10 | Info | Electron Security | Core Electron security configuration is correct |

---

### SEC-01 — High — Live OCR API Key in `.env.example`

**File:** `/Users/angelmarino/Code/prose/.env.example`

**Description:** The `.env.example` file committed to the repository contains what appears to be a real, functional OCR service API key (`REMARKABLE_OCR_API_KEY=elrsEvLpz47eOo2aH2pXZ8FOHpfiRiLX`) and a real AWS Lambda URL. The actual `.env` file (which is gitignored) also contains a matching Google OAuth client secret. While the `.env` itself is not committed, the example file exposes:
- A real OCR Lambda endpoint URL
- A real API key for the OCR service
- A real Google OAuth Client ID (less sensitive for desktop apps per Google's guidance, but still worth rotating after a leak)
- A real Google OAuth Client Secret (this **is** sensitive)

**Risk:** Anyone reading the public `.env.example` has the OCR API key and can make calls to the OCR Lambda or impersonate the Google OAuth application.

**Remediation:**
1. Immediately rotate `REMARKABLE_OCR_API_KEY` and `GOOGLE_CLIENT_SECRET`.
2. Replace all values in `.env.example` with clearly fake placeholders (e.g., `your-api-key-here`). The `.env.example` file already has a correct-format template — apply it to all fields consistently.
3. Audit the Lambda's access logs for unexpected usage.

---

### SEC-02 — Medium — `sandbox: false` on Main BrowserWindow

**File:** `/Users/angelmarino/Code/prose/src/main/index.ts` line 125

**Description:** The main BrowserWindow is created with `sandbox: false`. Electron's sandbox mode (enabled by default in recent Electron versions) restricts renderer processes from accessing Node.js APIs directly and provides OS-level process isolation. Disabling it weakens the defense-in-depth model — if a malicious script runs in the renderer (e.g., via an XSS in rendered markdown content), it has greater capabilities than it would in a sandboxed renderer.

The reason this is likely disabled is to allow the preload script to function — some preload patterns require `sandbox: false`. Electron 20+ supports sandboxed preloads, but only when the preload does not use Node.js APIs directly.

**Remediation:**
- Audit whether the preload script (`src/preload/index.ts`) uses any Node.js-only APIs. It currently imports from `electron` only (`contextBridge`, `ipcRenderer`) which are available in sandboxed preloads.
- If Node.js APIs are not needed in the preload, remove `sandbox: false` and test. Modern Electron versions (the project uses v40) support sandboxed preloads natively.
- If `sandbox: false` must be kept, document the rationale in a comment.

---

### SEC-03 — Medium — `file:saveToFolder` Missing Path Validation

**File:** `/Users/angelmarino/Code/prose/src/main/ipc.ts` lines 205–215

**Description:** Every other file-writing IPC handler in `ipc.ts` calls `validatePath()` before performing filesystem operations. The `file:saveToFolder` handler is the sole exception — it joins `folder` and `filename` directly without sanitizing either:

```typescript
ipcMain.handle(
  'file:saveToFolder',
  async (_event, folder: string, filename: string, content: string) => {
    const hasKnownExt = /\.(md|markdown|txt)$/.test(filename)
    const finalFilename = hasKnownExt ? filename : `${filename}.md`
    const fullPath = join(folder, finalFilename)
    await writeFile(fullPath, content, 'utf-8')   // No validatePath call
    return fullPath
  }
)
```

A renderer sending `filename: "../../../.ssh/authorized_keys"` (with a `.md` extension appended) or `folder: "/tmp"` with a crafted filename could write arbitrary content outside the intended directory.

**Remediation:**
```typescript
const safeFolder = validatePath(folder)
// Strip path separators from filename
const safeFilename = finalFilename.replace(/[/\\]/g, '-')
const fullPath = join(safeFolder, safeFilename)
```

---

### SEC-04 — Medium — XSS via `innerHTML` in AI Annotation Tooltip

**File:** `/Users/angelmarino/Code/prose/src/renderer/extensions/ai-annotations/plugin.ts` lines 39–43

**Description:** The annotation tooltip is constructed using `innerHTML` with values from the annotation's `provenance.model` field:

```typescript
tooltip.innerHTML = `
  <div class="ai-annotation-tooltip-header">${typeLabel}</div>
  <div class="ai-annotation-tooltip-model">${annotation.provenance.model}</div>
  <div class="ai-annotation-tooltip-time">${ageString}</div>
`
```

`typeLabel` is from a controlled `annotation.type` string (only `'insertion'` or `'replacement'`) so it is safe. However `annotation.provenance.model` comes from the LLM response metadata and `ageString` comes from `formatAge()` which formats a timestamp — both are derived from data that originates outside the app.

If a compromised or malicious LLM response included `<script>` or event-handler HTML in the model name field, it would execute in the renderer context. In practice, the Anthropic API returns a fixed model string (e.g., `claude-sonnet-4-5`), making this low-probability today, but it is a structural XSS risk.

**Remediation:** Use `textContent` instead of `innerHTML`, or escape HTML before interpolating:

```typescript
const tooltip = document.createElement('div')
tooltip.className = 'ai-annotation-tooltip'

const header = document.createElement('div')
header.className = 'ai-annotation-tooltip-header'
header.textContent = typeLabel

const model = document.createElement('div')
model.className = 'ai-annotation-tooltip-model'
model.textContent = annotation.provenance.model

const time = document.createElement('div')
time.className = 'ai-annotation-tooltip-time'
time.textContent = ageString

tooltip.append(header, model, time)
```

---

### SEC-05 — Medium — `local-file://` Protocol Bypasses CSP

**File:** `/Users/angelmarino/Code/prose/src/main/index.ts` lines 163–175

**Description:** A custom `local-file://` protocol is registered to serve images from the local filesystem, and it is granted `bypassCSP: true`:

```typescript
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
])
```

This means any resource loaded via `local-file://` will bypass the Content Security Policy headers set on the session. The handler restricts what it serves (it proxies to `file://` URLs), but the `bypassCSP` privilege is broad — it applies at the scheme level, not the handler level.

The handler itself does not validate the requested path:
```typescript
protocol.handle('local-file', (request) => {
  const filePath = decodeURIComponent(new URL(request.url).pathname)
  return net.fetch('file://' + filePath)  // No path validation
})
```

A crafted `local-file:///etc/passwd` or `local-file:///Users/angelmarino/.ssh/id_rsa` URL could read sensitive files from anywhere on disk. Combine this with the XSS in SEC-04 and the risk increases.

**Remediation:**
1. Add path validation in the `local-file` handler — only serve files within known document directories or with allowed extensions (image types only).
2. Evaluate whether `bypassCSP` is truly needed. If the CSP already permits `local-file:` in `img-src`, this flag is unnecessary.

---

### SEC-06 — Low — minimatch ReDoS (Build-Time Dependencies)

**Description:** 10 high-severity npm advisories all trace to `minimatch@10.0.0–10.2.2` in the `electron-builder` dependency tree. Two ReDoS vulnerabilities are present.

`package.json` has an override: `"minimatch": "10.2.1"` — this is within the vulnerable range. The fix requires `>=10.2.3`.

**Impact:** Build-time only. These packages do not run in the shipped app. Exploiting this would require a malicious glob pattern to reach the build tool, which is an extremely low risk in a private build environment.

**Remediation:**
```json
"overrides": {
  "minimatch": ">=10.2.3"
}
```
Or run `npm audit fix` and verify the override resolves correctly.

---

### SEC-07 — Low — Plaintext API Key Fallback

**File:** `/Users/angelmarino/Code/prose/src/main/ipc.ts` lines 492–495

**Description:** When `safeStorage` is unavailable, the app falls back to writing the Anthropic API key in plaintext to `~/.prose/settings.json`:

```typescript
} else {
  console.warn('[settings:save] Secure storage unavailable, saving API key in plaintext')
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}
```

`safeStorage` is available on all modern macOS systems (it uses the system keychain), so this path is unlikely to be hit in practice. However, if triggered (e.g., on a system with a broken keychain or during early first-run), the API key lands in a plaintext JSON file readable by any process running as the same user.

**Remediation:**
- Add a visible warning in the UI when secure storage is unavailable (the console warn is invisible to users).
- Consider refusing to save the API key if secure storage is unavailable, instead prompting the user to re-enter it each session.

---

### SEC-08 — Low — MCP HTTP Server Uses Wildcard CORS

**File:** `/Users/angelmarino/Code/prose/src/main/mcp/http-server.ts` lines 120–122

**Description:** The local MCP HTTP server (port 9877, bound to 127.0.0.1) sets `Access-Control-Allow-Origin: *`. This means any web page the user visits can make cross-origin requests to `http://localhost:9877/mcp` and invoke MCP tools (which can read/write documents and execute editor operations).

The server is marked as deprecated (being replaced by the Unix socket server), but it is still active in the current codebase.

**Remediation:**
- Restrict `Access-Control-Allow-Origin` to known origins (e.g., Claude Desktop's origin, or omit the header entirely since the primary client is Claude Desktop which sends same-origin requests or uses stdio).
- Prioritize removing this server in favor of the Unix socket approach, which is not accessible from browser contexts at all.

---

### SEC-09 — Info — No Secrets in Git History

Gitleaks has confirmed no secrets in the git commit history. The `.env` file is correctly gitignored. This audit found no hardcoded Anthropic API keys, tokens, or passwords in source code.

**Note:** The `.env.example` file does contain real credentials (see SEC-01). While this file is committed, the values are real service credentials, not example placeholders.

---

### SEC-10 — Info — Electron Security Baseline

The following Electron security best practices are correctly implemented:

| Control | Status | Detail |
|---|---|---|
| `contextIsolation: true` | Correct | Renderer cannot access Node.js via preload scope bleed |
| `nodeIntegration: false` | Correct | Renderer has no direct Node.js access |
| `webSecurity` | Default (enabled) | Not explicitly disabled |
| `setWindowOpenHandler` | Correct | New windows are denied; links open in system browser |
| `shell.openExternal` validation | Correct | Only http/https URLs allowed |
| CSP headers | Good | Applied via `onHeadersReceived`; production removes `unsafe-eval` |
| API key storage | Good | `safeStorage` used for Anthropic, Google, and reMarkable keys |
| Path traversal protection | Good (with gap) | `validatePath()` used on most handlers; SEC-03 is the exception |

---

## Prioritized Remediation

| Priority | ID | Action |
|---|---|---|
| Immediate | SEC-01 | Rotate OCR API key and Google OAuth secret; fix `.env.example` |
| High | SEC-03 | Add `validatePath` and filename sanitization to `file:saveToFolder` |
| High | SEC-05 | Add path validation in `local-file://` protocol handler |
| Medium | SEC-04 | Replace `innerHTML` in annotation tooltip with DOM API calls |
| Medium | SEC-02 | Evaluate removing `sandbox: false` from BrowserWindow config |
| Medium | SEC-08 | Restrict CORS on MCP HTTP server or remove server |
| Low | SEC-06 | Update minimatch override to `>=10.2.3` |
| Low | SEC-07 | Surface UI warning when secure storage is unavailable |
