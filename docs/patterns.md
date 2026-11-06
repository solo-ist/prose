# Common Patterns

Step-by-step recipes for extending Prose. Each recipe lists the files to touch and the order of operations.

---

## How to Add a Settings Tab

**Example:** The `integrations` tab in `SettingsDialog.tsx`.

1. **Add the tab name** to the `SettingsTab` union type in `src/renderer/stores/settingsStore.ts`.
2. **Add a scroll ref** — create `useRef<HTMLDivElement>(null)` in `SettingsDialog.tsx` and add it to the `tabRefs` map inside `handleTabChange()`.
3. **Update the grid** — increment `grid-cols-N` on the `<TabsList>` element.
4. **Add the trigger** — `<TabsTrigger value="mytab">My Tab</TabsTrigger>` inside `<TabsList>`.
5. **Add the content** — `<TabsContent value="mytab" className="space-y-4 mt-4 overflow-y-auto flex-1" ref={myTabRef}>` with your settings UI.
6. **Add config setter** (if needed) — follow the `setRemarkableConfig` / `setAutosaveConfig` pattern in `settingsStore.ts`: spread-merge into `settings`, then call `get().saveSettings()`.

---

## How to Add an IPC Channel

**Example:** `settings:load` / `settings:save` (simplest round-trip). For streaming, see `llm:stream:*`.

Three files, always in this order:

1. **Main process handler** — `src/main/ipc.ts`, inside `setupIpcHandlers()`:
   ```ts
   ipcMain.handle('myfeature:doThing', async (_event, arg: string) => {
     return result
   })
   ```
   Use `ipcMain.on` + `webContents.send` for push-from-main channels.

2. **Preload bridge** — `src/preload/index.ts`:
   - Add the method signature to the `ElectronAPI` interface.
   - Add the implementation to the `api` object:
     ```ts
     myFeatureDoThing: (arg: string) => ipcRenderer.invoke('myfeature:doThing', arg),
     ```
   - For push channels, use the `onXxx` / cleanup pattern (returns an unsubscribe function).

3. **Browser fallback** — `src/renderer/lib/browserApi.ts`:
   ```ts
   myFeatureDoThing: async (_arg: string) => {
     throw new Error('myFeatureDoThing is not available in browser mode')
   },
   ```

**Usage in renderer** — always via `getApi()`, never `window.api` directly:
```ts
import { getApi } from '../lib/browserApi'
const result = await getApi().myFeatureDoThing('value')
```

---

## How to Add a TipTap Extension

**Example:** `src/renderer/extensions/search-highlight/` (simple Extension), `src/renderer/extensions/image/` (a Node with a NodeView), `src/renderer/extensions/comments/` (a Mark whose records live in plugin state).

1. **Create the extension directory** — `src/renderer/extensions/my-extension/`:
   - `extension.ts` — the TipTap `Extension.create()`, `Node.create()`, or `Mark.create()` definition
   - `types.ts` — options interface and other types
   - `index.ts` — re-exports

2. **Choose the base class:**
   - `Extension.create<TOptions, TStorage>()` — behavior/plugins with no new schema nodes
   - `Node.create<TOptions>()` — new document node types
   - `Mark.create<TOptions>()` — inline marks

3. **Implement the extension** — define `name`, `addOptions()`, `addCommands()`, and `addProseMirrorPlugins()` as needed. Declare custom commands via `declare module '@tiptap/core'`. **Never keep per-document data in `addStorage()` or in a closure of `addProseMirrorPlugins()`**: there is one editor and one extension instance for every open tab, so anything outside the `EditorState` is shared across documents. Per-document data goes in a ProseMirror plugin's state (`new Plugin({ state: { init, apply } })`), written by transaction metas, as `extensions/comments/plugin.ts` does.

4. **Register in the editor** — `src/renderer/components/editor/extensions.ts`, add to the list `createEditorExtensions()` returns (the vitest harness builds the same list):
   ```ts
   import { MyExtension } from '../../extensions/my-extension'
   // in createEditorExtensions:
   MyExtension.configure({ myOption: 'value' }),
   ```

---

## How to Add a Panel

**Example:** Chat panel (`chatStore.ts` + `usePanelLayout.ts` + `App.tsx`).

1. **Store state** — add `isPanelOpen: boolean` and `setPanelOpen(open: boolean)` to the panel's Zustand store (or create a new one).

2. **Layout hook** — `src/renderer/hooks/usePanelLayout.ts`:
   - Add min/max pixel constants (e.g., `MY_PANEL_MIN_PX = 280`).
   - Add the panel ref to `UsePanelLayoutOpts`.
   - Subscribe to the store's `isPanelOpen`.
   - Add a `useLayoutEffect` branch to imperatively resize via `panelRef.current?.resize()`.

3. **App layout** — `src/renderer/components/layout/App.tsx`:
   - Create `const myPanelRef = useRef<ImperativePanelHandle>(null)`.
   - Pass it to `usePanelLayout()`.
   - Add `<ResizableHandle>` + `<ResizablePanel>` inside the `ResizablePanelGroup`.

4. **Update width threshold** — adjust `BOTH_PANELS_MIN_WIDTH` in `usePanelLayout.ts` if three panels should coexist.

**Key constants** (all in `usePanelLayout.ts`):
- `FILE_LIST_MIN_PX = 280`, `FILE_LIST_MAX_PX = 500`
- `CHAT_MIN_PX = 280`, `CHAT_MAX_PX = 610`
- `EDITOR_MIN_PX = 360`, `BOTH_PANELS_MIN_WIDTH = 1000`

---

## How to Add a Zustand Store

**Example:** `src/renderer/stores/fileListStore.ts` (simple), `src/renderer/stores/chatStore.ts` (complex with subscriptions).

```ts
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { getApi } from '../lib/browserApi'

interface MyState {
  items: string[]
  isLoading: boolean
  addItem: (item: string) => void
  loadItems: () => Promise<void>
}

export const useMyStore = create<MyState>()(
  subscribeWithSelector((set, get) => ({
    items: [],
    isLoading: false,
    addItem: (item) => set((state) => ({ items: [...state.items, item] })),
    loadItems: async () => {
      set({ isLoading: true })
      try {
        const result = await getApi().someIpcCall()
        set({ items: result, isLoading: false })
      } catch (err) {
        console.error('Failed:', err)
        set({ isLoading: false })
      }
    },
  }))
)
```

**Rules:**
- **Always use `subscribeWithSelector`** — every store in the codebase uses it.
- **Call `getApi()` inside actions**, not at module scope — `window.api` may not be set yet at import time.
- **Spread-merge nested state** — `set(s => ({ settings: { ...s.settings, key: value } }))`.
- **Imperative access** outside React — `useMyStore.getState()` / `useMyStore.setState()`.
- **External subscriptions** — `useMyStore.subscribe(selector, callback)` for side effects outside React.

---

## How to Add an AI Tool

**Example:** `read_document` (simplest — no params, available in all modes). See `suggest_edit` for a complex tool with provenance.

1. **Define schema and config** — in the appropriate file under `src/shared/tools/schemas/` (or create a new one):
   ```ts
   import { z } from 'zod'
   import type { ToolConfig } from '../types'

   export const myToolSchema = z.object({
     param1: z.string().describe('What this param does'),
   })

   export const myToolConfig: ToolConfig<typeof myToolSchema> = {
     name: 'my_tool',
     description: 'What this tool does (shown to the LLM)',
     schema: myToolSchema,
     category: 'document',
     requiresMode: null,    // null = all modes, 'full' = full only
     dangerous: false,
   }
   ```

2. **Export from the schema group** — add `myToolConfig` to the category's export array (e.g., `documentTools`).

3. **Register** — `src/shared/tools/registry.ts`: add the tools array to `allTools`:
   ```ts
   export const allTools = [...documentTools, ...editorTools, ...fileTools] as const
   ```
   For MCP exposure, add the tool name to `mcpToolNames`.

4. **Write the executor** — `src/renderer/lib/tools/executors/`. An executor takes the validated args and a `ToolContext` (`lib/tools/context.ts`): `ctx.handle` is the `DocumentHandle` of the document the call is bound to (shown or not), `ctx.provenance` the model / conversation / message that made the call. Read and write the document through the handle, never through the editor instance or the editor store:
   ```ts
   export function executeMyTool(args: { param1: string }, ctx: ToolContext): ToolResult {
     const { handle } = ctx
     if (!handle) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
     const text = handle.state.doc.textContent         // read the state
     handle.commands.insertContentAt(0, 'x')           // or a transaction: handle.apply(handle.state.tr…)
     return toolSuccess({ result: text.length })
   }
   ```
   `handle.view` exists only while the document is shown (`handle.isActive`): use it for scrolling and focus, never for the edit itself. `isEditorReadOnly(handle)` gates writes on preview and reMarkable tabs; a target in source mode is refused before the executor runs.

5. **Wire the dispatcher** — `src/renderer/lib/tools/index.ts`: add a `case` to the `switch` in `executeTool()`, and the tool's name to `DOCUMENT_TOOLS` (it needs a handle) or `WRITING_TOOLS` (it writes):
   ```ts
   case 'my_tool':
     return executeMyTool(validatedArgs, ctx)
   ```

**Tool modes:** `requiresMode: null` = available everywhere. `requiresMode: 'full'` = only in Full Autonomy mode. See `docs/architecture/llm-pipeline.md` for details.

---

## How to Add a Session Writer or Projection

**Example:** `afterTransaction` and `persistRecords` in `src/renderer/document/session.ts` (the annotation and comment persisters), `writeProjection` (the dirty rule), `scheduleSuggestionProjection`.

Editor state is per tab (`docs/architecture/editor-state.md`): every open tab owns an `EditorState`, and only `session.ts` creates one, swaps one into the view, or persists what one holds. Anything that writes a document's records to IndexedDB, or derives something from a document's state into a store or the tab record, is a *projection* in that file.

1. **Read from the state, write under its id** — a projection takes the `Session` (or the `EditorState`) and reads both the records and the document id from it:
   ```ts
   const identity = getIdentity(session.state)          // { documentId, path, plain }
   const rows = annotationsOf(session.state)            // or threadsOf, getAISuggestions({ state })
   session.annotationWrite = persistRecords('annotations', identity.documentId, rows)
   ```
   Never read the records from one place and the id from another; never read `editorStore.document` to decide what to persist.

2. **Decide when it runs** — from `afterTransaction(session, prev)` (every transaction of a shown session and every `applyToSession` on a background one): compare the plugin state's `revision` / `urgentRevision` with what the session last wrote, persist at once for an urgent change (add, remove, resolve) and on a timer for a plain move; the timer is flushed by `flushProjections` (leave, save, close). A projection into the tab record goes through `writeProjection` so the dirty flag stays one comparison against `session.saved`.

3. **Keep it per session, not per module** — timers and "last written" markers live on the `Session` object (`annotationTimer`, `annotationsPersisted`, …), never in a module variable: two tabs run the same code.

4. **Pin it** — a vitest in `session.test.ts` with two tabs open (the headless editor from `createEditorExtensions()`): the write lands under the right id, nothing lands under the other tab's id, the timer flushes on `closeSession`.

**Rules:**
- The IndexedDB writers in `lib/persistence.ts` are imported only by `session.ts`; `persistRecords` / `deleteDocumentRecords` are called only from `session.ts` and `tabs/actions.ts`; `view.updateState` and `EditorState.create` appear only in `session.ts`; no renderer code calls `commands.setContent`. The tripwires in `e2e/electron.document-sessions.spec.ts` fail the suite otherwise.
- No timing flag guarding shared state: a load is a pure function that returns a finished state; a record is added in the transaction that creates it.
- `editorStore.document` is a mirror of the active tab, written by the session layer and `tabs/actions.ts`; components read `useActiveTab(select)` / `useActiveSession(select)` for the truth.
