# Troubleshooting

Recovery playbook for common failures during development and QA.

---

## Dev Server Won't Start

**Symptom**: `npm run dev` hangs or exits immediately.

**Check 1 — Stale PID file**:
```bash
cat .dev.pid          # read the PID
ps -p <PID> -o pid=   # check if still running
```
If the process is dead but the PID file exists, delete it and retry:
```bash
rm .dev.pid && npm run dev
```

**Check 2 — Port conflict** (another agent or process):
```bash
lsof -i :5173   # Vite default
lsof -i :9222   # Electron DevTools
```
Vite auto-selects an alternative port for HMR, but port 9222 conflicts will cause a launch failure. Kill the conflicting process or wait for the other agent to finish.

**Check 3 — LevelDB lock**:
```
Error: LOCK: Resource temporarily unavailable
```
Another Electron instance has the IndexedDB open. Kill it using the PID file (see CLAUDE.md Dev Server PID Protocol), then restart.

---

## Build Fails

**Symptom**: `npm run build` exits with a non-zero code.

**Check TypeScript errors** first:
```bash
npx tsc --noEmit
```

**Check for missing imports**: Vite tree-shakes aggressively. If a module is used only at runtime (e.g., via dynamic `require`), it may be excluded. Add it to `optimizeDeps` in `vite.config.ts` if needed.

**Electron packager errors**: `electron-builder` errors often appear in `dist/`. Check `dist/builder-debug.yml` for a detailed build log.

---

## Circuit Electron Can't Find the App

**Symptom**: Circuit Electron MCP launches but the app window doesn't appear or shows an old version.

**Fix**: Always build before using Circuit Electron — it reads from `out/`, not the dev server:
```bash
npm run build
```
Then relaunch via Circuit Electron in development mode from the project directory.

If the window still shows stale content, delete `out/` and rebuild:
```bash
rm -rf out/ && npm run build
```

---

## IPC Call Returns `undefined`

**Symptom**: A `getApi().someChannel()` call resolves to `undefined` instead of the expected value.

**Check 1 — Handler not registered**: Confirm `ipcMain.handle('channel:name', ...)` exists in `src/main/ipc.ts` and that `setupIPC()` is called in `src/main/index.ts`.

**Check 2 — Preload not exposed**: Confirm the channel is listed in `src/preload/index.ts` and the `ElectronAPI` type in `src/renderer/types/index.ts`.

**Check 3 — Handler throws silently**: IPC handlers that throw return `undefined` to the renderer. Add a try/catch with logging in the handler:
```ts
ipcMain.handle('channel:name', async (_event, arg) => {
  try {
    return await doSomething(arg)
  } catch (err) {
    console.error('[ipc] channel:name failed', err)
    throw err  // re-throw so renderer gets a rejected promise
  }
})
```

---

## Settings Not Persisting

**Symptom**: Settings revert to defaults on restart.

**Check 1**: Confirm `~/.prose/settings.json` exists and is writable:
```bash
cat ~/.prose/settings.json
ls -la ~/.prose/
```

**Check 2**: The `settings:save` IPC handler writes the full settings object. If a new field is missing from `defaultSettings` in `src/main/ipc.ts`, it won't be included. Add it to `defaultSettings` and bump the settings version if you introduce breaking changes.

---

## Streaming Stops Mid-Response

**Symptom**: The assistant response cuts off and the loading spinner disappears without an error.

**Likely cause**: The `llm:stream:end` event fired before all chunks arrived, or the stream was aborted.

**Check the main process logs** (DevTools → Console for the main process, or run `npm run dev` in a visible terminal):
```
[llm] stream ended prematurely: <reason>
```

**Check Anthropic API limits**: Long responses may hit `maxTokens`. Increase `settings.maxTokens` in Settings → LLM or the default in `src/main/ipc.ts`.

---

## reMarkable Sync Fails

**Symptom**: Sync completes but no notebooks appear, or OCR produces garbled text.

**Step 1** — Re-register the device:
```
Settings → Integrations → reMarkable → Re-register
```

**Step 2** — Check `~/.prose/remarkable/` exists and contains downloaded `.pdf` or `.rm` files after sync.

**Step 3** — OCR requires an Anthropic API key. Verify it's set in Settings → LLM (or the dedicated OCR key in Settings → Integrations). Test with:
```bash
cat ~/.prose/settings.json | grep anthropic
```

---

## Dark Mode Flicker on Load

**Symptom**: The app briefly shows a white background before switching to dark mode.

This is a known rendering timing issue. The `dark` class is applied to `<html>` after React hydrates. Mitigation: ensure the `<html>` element has `class="dark"` set via a synchronous script in `index.html` before the React bundle loads.

---

## IndexedDB Upgrade Blocked

**Symptom**: After bumping `DB_VERSION`, draft recovery or chat history stops working.

**Cause**: The old database version is open in another tab or window. The `onupgradeneeded` callback waits for all connections to close.

**Fix**: Close all Prose windows, then reopen. For development, use DevTools → Application → IndexedDB → Delete database to force a clean slate.
