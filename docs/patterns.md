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

**Example:** `src/renderer/extensions/search-highlight/` (simple Extension), `src/renderer/extensions/diff-suggestions/` (full Node with NodeView).

1. **Create the extension directory** — `src/renderer/extensions/my-extension/`:
   - `extension.ts` — the TipTap `Extension.create()`, `Node.create()`, or `Mark.create()` definition
   - `types.ts` — options interface and other types
   - `index.ts` — re-exports

2. **Choose the base class:**
   - `Extension.create<TOptions, TStorage>()` — behavior/plugins with no new schema nodes
   - `Node.create<TOptions>()` — new document node types
   - `Mark.create<TOptions>()` — inline marks

3. **Implement the extension** — define `name`, `addOptions()`, `addStorage()`, `addCommands()`, and `addProseMirrorPlugins()` as needed. Declare custom commands via `declare module '@tiptap/core'`.

4. **Register in the editor** — `src/renderer/components/editor/Editor.tsx`, add to the `extensions` array:
   ```ts
   import { MyExtension } from '../../extensions/my-extension'
   // in useTipTapEditor:
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

4. **Write the executor** — `src/renderer/lib/tools/executors/`:
   ```ts
   export function executeMyTool(args: { param1: string }): ToolResult {
     const editor = useEditorInstanceStore.getState().editor
     if (!editor) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
     // ... use Zustand stores via .getState(), not hooks
     return toolSuccess({ result: 'data' })
   }
   ```

5. **Wire the dispatcher** — `src/renderer/lib/tools/index.ts`: add a `case` to the `switch` in `executeTool()`:
   ```ts
   case 'my_tool':
     return executeMyTool(validatedArgs)
   ```

**Tool modes:** `requiresMode: null` = available everywhere. `requiresMode: 'full'` = only in Full Autonomy mode. See `docs/architecture/llm-pipeline.md` for details.
