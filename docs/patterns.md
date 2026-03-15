# Common Patterns

Implementation recipes for common extension points in Prose.

---

## How to Add a Settings Tab

Settings live in `src/renderer/components/settings/SettingsDialog.tsx`. The tab system uses shadcn/ui `Tabs`.

**Step 1 — Add the tab type to `Settings`** (`src/renderer/types/index.ts`):
```ts
// Extend the dialogTab union
dialogTab: 'general' | 'editor' | 'llm' | 'integrations' | 'account' | 'myNewTab'
```

**Step 2 — Add a ref** in `SettingsDialog.tsx`:
```tsx
const myNewTabRef = useRef<HTMLDivElement>(null)

// Add to the tabRefs map inside handleTabChange:
myNewTab: myNewTabRef,
```

**Step 3 — Add trigger and content** (increase grid-cols by 1):
```tsx
<TabsList className="grid w-full grid-cols-6 ...">
  ...
  <TabsTrigger value="myNewTab">My Tab</TabsTrigger>
</TabsList>

<TabsContent value="myNewTab" className="space-y-4 mt-4 overflow-y-auto flex-1" ref={myNewTabRef}>
  {/* content here */}
</TabsContent>
```

**Step 4 — Add new settings fields** to `src/renderer/types/index.ts` and set defaults in `src/main/ipc.ts` (`defaultSettings`).

---

## How to Add an IPC Channel

IPC channels are defined in `src/main/ipc.ts` (main process) and exposed via `src/preload/index.ts`.

**Step 1 — Register the handler** in `src/main/ipc.ts`:
```ts
ipcMain.handle('myFeature:doSomething', async (_event, arg: string) => {
  // Node.js / native code here
  return { result: 'ok' }
})
```

**Step 2 — Expose in preload** (`src/preload/index.ts`):
```ts
const api = {
  // ... existing channels
  myFeatureDoSomething: (arg: string) =>
    ipcRenderer.invoke('myFeature:doSomething', arg),
}
```

**Step 3 — Add to `ElectronAPI` type** (`src/renderer/types/index.ts`):
```ts
interface ElectronAPI {
  // ... existing
  myFeatureDoSomething: (arg: string) => Promise<{ result: string }>
}
```

**Step 4 — Add browser fallback** in `src/renderer/lib/browserApi.ts` if the feature should work in web mode. Return a stub or throw a descriptive error.

**Step 5 — Call from renderer** via `getApi()`:
```ts
import { getApi } from '../lib/browserApi'
const result = await getApi().myFeatureDoSomething('hello')
```

Follow the naming convention `namespace:action` (e.g., `file:save`, `settings:load`).

---

## How to Add a TipTap Extension

The editor is at `src/renderer/components/editor/Editor.tsx`. Extensions are passed to the `useEditor` hook.

**Step 1 — Create the extension file** (e.g., `src/renderer/extensions/MyExtension.ts`):
```ts
import { Extension } from '@tiptap/core'

export const MyExtension = Extension.create({
  name: 'myExtension',

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-M': () => {
        // do something with this.editor
        return true
      },
    }
  },

  // or addInputRules(), addPasteRules(), addCommands(), etc.
})
```

**Step 2 — Register in `Editor.tsx`**:
```tsx
import { MyExtension } from '../extensions/MyExtension'

const editor = useEditor({
  extensions: [
    // ... existing extensions
    MyExtension,
  ],
  // ...
})
```

**Step 3 — Add commands to `EditorAPI`** (optional): If the extension exposes commands that the chat or toolbar needs to call, add them to the editor instance methods exposed via `editorInstanceStore`.

---

## How to Add a Panel

Panels (chat, file list, sidebar) use the `ResizablePanelGroup` from `@react-resizable-panels`.

**Step 1 — Add panel state to a Zustand store** (or create a new one):
```ts
// src/renderer/stores/myPanelStore.ts
import { create } from 'zustand'

interface MyPanelStore {
  isOpen: boolean
  setOpen: (open: boolean) => void
}

export const useMyPanelStore = create<MyPanelStore>((set) => ({
  isOpen: false,
  setOpen: (open) => set({ isOpen: open }),
}))
```

**Step 2 — Add the panel to the layout** (`src/renderer/components/layout/`):
```tsx
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '../ui/resizable'
import { useMyPanelStore } from '../../stores/myPanelStore'

const { isOpen } = useMyPanelStore()

<ResizablePanelGroup direction="horizontal">
  <ResizablePanel defaultSize={70}>
    {/* main content */}
  </ResizablePanel>
  {isOpen && (
    <>
      <ResizableHandle />
      <ResizablePanel defaultSize={30} minSize={20}>
        {/* panel content */}
      </ResizablePanel>
    </>
  )}
</ResizablePanelGroup>
```

**Step 3 — Add a keyboard shortcut** in `src/renderer/components/layout/` or the menu (`src/main/menu.ts`).

---

## How to Add a Zustand Store

Stores live in `src/renderer/stores/`. Follow the existing pattern.

```ts
// src/renderer/stores/myStore.ts
import { create } from 'zustand'

interface MyState {
  value: string
  setValue: (v: string) => void
  reset: () => void
}

const initialState = {
  value: '',
}

export const useMyStore = create<MyState>((set) => ({
  ...initialState,
  setValue: (value) => set({ value }),
  reset: () => set(initialState),
}))
```

Guidelines:
- Keep stores focused on a single concern.
- Put derived values in selectors, not in the store.
- Use `initialState` pattern to make `reset()` reliable.
- Do **not** use `persist` middleware for ephemeral UI state — only for state that should survive reloads (currently only `settingsStore` persists via the main process, not Zustand persist).

---

## How to Add an AI Tool

AI tools are defined in the LLM system prompt and parsed from the model's response by the chat hook.

**Step 1 — Define the tool in the system prompt** (`src/renderer/hooks/useChat.ts` or the prompt template):
```
<tool name="myTool">
  <description>Does something useful</description>
  <parameter name="target" type="string" required="true">The target text</parameter>
</tool>
```

**Step 2 — Parse the tool call** in the message processing logic:
```ts
// In useChat.ts, after receiving the assistant message:
const toolCall = parseToolCall(message.content, 'myTool')
if (toolCall) {
  await handleMyTool(toolCall.parameters)
}
```

**Step 3 — Implement the handler**:
```ts
async function handleMyTool(params: { target: string }) {
  const editor = useEditorInstanceStore.getState().editor
  if (!editor) return
  // manipulate editor or call an IPC channel
}
```

**Step 4 — Surface feedback to the user**: Add a visual indicator in the chat message (e.g., a tool-result badge) so the user knows the tool ran. See `AISuggestionPopover.tsx` for an example of surfacing AI-driven actions.
