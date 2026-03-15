# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email **security@solo.ist** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
3. You'll receive a response within 48 hours

## Scope

Security issues in these areas are in scope:

- **Electron sandbox and process isolation** — `contextIsolation`, `nodeIntegration`, `sandbox` settings
- **IPC handler input validation** — path traversal, injection attacks
- **Secret management** — API key storage, credential leakage
- **XSS vectors** — dynamic HTML injection, especially from LLM-generated content
- **Protocol handling** — `shell.openExternal`, custom URL schemes
- **CORS and network security** — MCP HTTP server, CSP headers

## Security Practices

- All filesystem IPC handlers validate paths via `validatePath()` (rejects `..` traversal)
- API keys are stored via OS `safeStorage` (`credentialStore`), never in plaintext
- `contextIsolation: true` and `nodeIntegration: false` on all windows
- `shell.openExternal` restricted to `http:`/`https:` protocols
- MCP HTTP server CORS restricted to `localhost`/`127.0.0.1`
- No dynamic `innerHTML` with LLM-generated content

## Prior Audits

- **March 2026**: Full codebase security audit (`docs/issues/127/findings.md`). All critical and high findings resolved in PRs #294 and #316.
