# Troubleshooting

Common failures and how to recover.

---

## Port 9222 Conflict

Dev mode enables Chrome DevTools on port 9222 (`src/main/index.ts`). If another Electron instance holds the port, the app won't launch.

**Fix:**
1. Check `.dev.pid` — `cat .dev.pid`
2. Kill that PID — `kill <PID>`
3. If PID file is missing: `lsof -ti:9222 | xargs kill -9`
4. Restart dev server — `npm run dev`

**Note:** Multiple Claude Code agents may run simultaneously. Use the PID file method to avoid killing another agent's process.

---

## LevelDB Lock

Chromium's embedded LevelDB locks its database files. If a dev server is still running when a second instance starts, you'll see lock errors.

**Fix:**
1. Kill the existing dev server via `.dev.pid`
2. If no PID file: `pkill -f "prose.*Electron"` then `pkill -f "electron-vite.*prose"`
3. Restart — `npm run dev`

**Never:** `pkill -f node` (kills Circuit Electron MCP) or `pkill -f Electron` (kills all Electron apps).

---

## API Errors

| Error Pattern | Cause | Fix |
|---------------|-------|-----|
| `401 Unauthorized` | Invalid or expired API key | Check key in Settings → LLM |
| `429 Too Many Requests` | Rate limit exceeded | Wait and retry, or switch to a lower-traffic model |
| `Network Error` / `ECONNREFUSED` | No internet or API down | Check connection; Anthropic status at status.anthropic.com |
| `Model not found` | Invalid model name | Use a valid Anthropic model ID |
| `Could not process` / 500 | Transient API error | Retry; if persistent, check API status |

The stream error handler (`useChat.ts`) auto-detects these patterns and appends actionable guidance to the chat message.

---

## Build Failures

The build has three separate compilations (all via electron-vite):
- **Main process** → `out/main/`
- **Preload** → `out/preload/`
- **Renderer** → `out/renderer/`

If only one target fails, check `src/shared/` first — files there are imported by multiple targets and type errors propagate.

**Common issues:**
- Missing import → check if a new export was added to `src/shared/` but not yet used
- Type mismatch in IPC → ensure `ElectronAPI` interface in preload matches the handler in `ipc.ts`
- Vite HMR stale → restart dev server

---

## Circuit Electron

Circuit Electron QA needs:
1. Port 9222 free (see above)
2. A fresh build — `npm run build` (Circuit launches its own Electron, doesn't use the dev server)
3. Node 24+ (configured via fnm at the parent-level `.mcp.json`)

**After testing:** delete screenshot artifacts — `rm electron-screenshot-*.jpeg`

---

## Tool Execution Errors

When the AI's tool calls fail, the error code tells you what went wrong:

| Code | Meaning | Likely Fix |
|------|---------|------------|
| `NODE_NOT_FOUND` | Stale node ID — document changed since AI read it | AI should re-read the document |
| `EDITOR_NOT_AVAILABLE` | Source/markdown mode active, or editor not mounted | Switch to rich text mode |
| `EDITOR_READ_ONLY` | reMarkable OCR tab or preview tab | Switch to an editable document |
| `MODE_RESTRICTED` | Tool not available in current tool mode | Switch to Full Autonomy mode |
| `INVALID_ARGS` | Bad input from the LLM | AI should retry with correct parameters |
| `UNKNOWN_TOOL` | Tool name doesn't exist | Check tool registry |

The tool loop has two circuit breakers:
- **Max roundtrips** — stops after 5 consecutive tool-use → result cycles
- **Duplicate failure** — stops if the same tool fails with the same error twice in a row
