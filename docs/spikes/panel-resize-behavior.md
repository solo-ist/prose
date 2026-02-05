# SPIKE: Panel and Window Resize Behavior Analysis

## Summary

This document captures the current implementation of window sizing, panel layout, and resize behavior in Prose. The goal is to understand the existing logic before addressing reported "weirdness" with resize behavior.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│ BrowserWindow (Electron)                                                 │
│ Default: 1200×800 | Min: 800×600                                        │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Toolbar (48px fixed height)                                          │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │ ResizablePanelGroup (horizontal)                                     │ │
│ │ ┌──────────────┬─┬──────────────────────┬─┬────────────────────────┐ │ │
│ │ │ FileListPanel│ │ Editor               │ │ ChatPanel              │ │ │
│ │ │ (conditional)│H│ (always)             │H│ (conditional)          │ │ │
│ │ │              │a│                      │a│                        │ │ │
│ │ │              │n│                      │n│                        │ │ │
│ │ │              │d│                      │d│                        │ │ │
│ │ │              │l│                      │l│                        │ │ │
│ │ │              │e│                      │e│                        │ │ │
│ │ └──────────────┴─┴──────────────────────┴─┴────────────────────────┘ │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │ StatusBar (fixed height)                                             │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Window Constraints

**Source:** `src/main/index.ts` (lines 107-123)

| Property | Value | Notes |
|----------|-------|-------|
| `width` | 1200 | Default width |
| `height` | 800 | Default height |
| `minWidth` | 800 | Minimum width |
| `minHeight` | 600 | Minimum height |
| `titleBarStyle` | `hiddenInset` | macOS traffic lights inside window |
| `trafficLightPosition` | `{ x: 16, y: 16 }` | Traffic light offset |

## Panel Library

**Library:** `react-resizable-panels` (via `src/renderer/components/ui/resizable.tsx`)

The library provides:
- `ResizablePanelGroup` - Container for panels
- `ResizablePanel` - Individual panel with size constraints
- `ResizableHandle` - Draggable divider between panels

**Key props:**
- `id` - Panel identifier (used for localStorage persistence if `autoSaveId` is set on group)
- `defaultSize` - Initial size as percentage (0-100)
- `minSize` / `maxSize` - Size constraints as percentages

## Panel Configuration

**Source:** `src/renderer/components/layout/App.tsx` (lines 703-729)

### File List Panel (Left)

| Property | Value | Notes |
|----------|-------|-------|
| `id` | `"file-list"` | Panel identifier |
| `defaultSize` | `20` | 20% of container |
| `minSize` | `15` | 15% minimum |
| `maxSize` | `35` | 35% maximum |
| `className` | `"min-w-[16.25rem]"` | 260px CSS minimum |

**State:** `useFileListStore.isPanelOpen`
- **Default:** `false` (closed on app start)
- **Source:** `src/renderer/stores/fileListStore.ts` line 54

### Editor Panel (Center)

| Property | Value | Notes |
|----------|-------|-------|
| `id` | `"editor"` | Panel identifier |
| `defaultSize` | Dynamic | See table below |
| `minSize` | `30` | 30% minimum |
| `maxSize` | (none) | Can fill remaining space |

**Dynamic defaultSize logic:**
| File List | Chat | Editor defaultSize |
|-----------|------|--------------------|
| Open | Open | 40% |
| Open | Closed | 50% |
| Closed | Open | 50% |
| Closed | Closed | 100% |

### Chat Panel (Right)

| Property | Value | Notes |
|----------|-------|-------|
| `id` | `"chat"` | Panel identifier |
| `defaultSize` | Dynamic | See table below |
| `minSize` | `20` | 20% minimum |
| `maxSize` | `60` | 60% maximum |

**Dynamic defaultSize logic:**
| File List | Chat defaultSize |
|-----------|------------------|
| Open | 40% |
| Closed | 50% |

**State:** `useChatStore.isPanelOpen`
- **Default:** `true` (open on app start)
- **Source:** `src/renderer/stores/chatStore.ts` line 85

## Panel Toggle Flow

### Toggle Entry Points

1. **Toolbar buttons** (`src/renderer/components/layout/Toolbar.tsx`)
   - File list toggle: lines 200-212
   - Chat toggle: lines 384-396
   - Calls `toggleFileListPanel()` / `toggleChatPanel()` directly

2. **Menu actions** (`src/renderer/components/layout/App.tsx` lines 616-629)
   - `toggleChat` / `toggleFileList` menu items
   - Has **additional auto-close logic** (see below)

3. **Keyboard shortcuts** (via menu)
   - `Cmd+Shift+E` - Toggle file list (`src/main/menu.ts` line 165)
   - `Cmd+Shift+L` - Toggle chat (`src/main/menu.ts` line 172)

### Auto-Close Logic

**Source:** `src/renderer/components/layout/App.tsx` lines 57-58, 616-629

```typescript
const MIN_WIDTH_FOR_BOTH_PANELS = 3000

case 'toggleChat':
  // If opening chat AND file list is open AND window is narrow
  if (!isChatOpen && isFileListOpen && window.innerWidth < MIN_WIDTH_FOR_BOTH_PANELS) {
    setFileListPanelOpen(false)
  }
  toggleChatPanel()
  break

case 'toggleFileList':
  // If opening file list AND chat is open AND window is narrow
  if (!isFileListOpen && isChatOpen && window.innerWidth < MIN_WIDTH_FOR_BOTH_PANELS) {
    setChatPanelOpen(false)
  }
  toggleFileListPanel()
  break
```

**Observations:**
- Threshold of 3000px is extremely high (most monitors are 1920-2560px wide)
- Auto-close only triggers on menu actions, NOT on toolbar button clicks
- No auto-close on window resize events
- No auto-close when opening both panels simultaneously

## State Management

### Chat Panel State

**Store:** `src/renderer/stores/chatStore.ts`

```typescript
interface ChatState {
  isPanelOpen: boolean  // Default: true
  togglePanel: () => void
  setPanelOpen: (open: boolean) => void
}
```

### File List Panel State

**Store:** `src/renderer/stores/fileListStore.ts`

```typescript
interface FileListState {
  isPanelOpen: boolean  // Default: false
  togglePanel: () => void
  setPanelOpen: (open: boolean) => void
}
```

### Hooks

- **`useChat()`** - Returns `isPanelOpen`, `togglePanel`, `setPanelOpen` from chatStore
- **`useFileList()`** - Returns `isPanelOpen`, `togglePanel`, `setPanelOpen` from fileListStore

## Identified Issues

### 1. Inconsistent Auto-Close Behavior

**Problem:** Auto-close logic only runs for menu actions, not toolbar buttons.

**Impact:** Users clicking toolbar buttons don't get the same narrow-window protection.

**Affected code:**
- Menu path: `App.tsx` lines 616-629 (has auto-close)
- Toolbar path: `Toolbar.tsx` lines 201, 385 (no auto-close)

### 2. Arbitrary Width Threshold

**Problem:** `MIN_WIDTH_FOR_BOTH_PANELS = 3000` is extremely high.

**Impact:** On a 1920px monitor, both panels can never be open simultaneously via menu actions. But they CAN be opened via toolbar buttons.

**Calculation at 1200px window (default):**
- File list at 20%: 240px
- Editor at 40%: 480px
- Chat at 40%: 480px
- Total: 1200px (fits fine)

### 3. CSS vs Percentage Conflicts

**Problem:** File list has both CSS `min-w-[16.25rem]` (260px) AND percentage `minSize={15}`.

**Impact:** At 800px window width:
- 15% of 800px = 120px
- CSS minimum = 260px
- CSS wins, but library may not account for this

### 4. defaultSize Not Reactive

**Problem:** Panel `defaultSize` is computed at render time based on current state, but react-resizable-panels only uses it for initial sizing.

**Impact:** Toggling a panel doesn't cause other panels to resize to their calculated defaults. They maintain whatever size they had from dragging.

### 5. No Size Persistence

**Problem:** `ResizablePanelGroup` doesn't have `autoSaveId` set.

**Impact:** Panel sizes reset to defaults on page reload. User's preferred sizes are lost.

### 6. No Window Resize Listener

**Problem:** No listener for `window.resize` events to adjust panels.

**Impact:** If user shrinks window while both panels are open, panels may become cramped rather than auto-closing.

## Size Calculation Examples

### Scenario: 1200px window (default)

| File List | Chat | File List Size | Editor Size | Chat Size |
|-----------|------|----------------|-------------|-----------|
| Open | Open | 240px (20%) | 480px (40%) | 480px (40%) |
| Open | Closed | 240px (20%) | 960px (80%) | - |
| Closed | Open | - | 600px (50%) | 600px (50%) |
| Closed | Closed | - | 1200px (100%) | - |

### Scenario: 800px window (minimum)

| File List | Chat | File List Size | Editor Size | Chat Size |
|-----------|------|----------------|-------------|-----------|
| Open | Open | 260px (CSS min) | 240px (30% min) | 300px (remainder) |
| Open | Closed | 260px (CSS min) | 540px | - |
| Closed | Open | - | 400px (50%) | 400px (50%) |

**Issue:** At 800px with both panels open:
- File list CSS min: 260px
- Editor library min (30%): 240px
- Remaining for chat: 300px (37.5%, below its minSize of 20%? No, 20% of 800 = 160px so OK)
- But chat's maxSize is 60% (480px) and defaultSize is 40% (320px)

## Recommendations

### Quick Fixes

1. **Unify auto-close logic** - Move to store/hook level so both toolbar and menu use it
2. **Lower threshold** - Change `MIN_WIDTH_FOR_BOTH_PANELS` to ~1400px or calculate dynamically
3. **Add autoSaveId** - `<ResizablePanelGroup autoSaveId="prose-panels">` for size persistence

### Medium-Term Improvements

4. **Add resize listener** - Auto-close panels when window becomes too narrow
5. **Remove CSS min-width** - Let library handle all sizing
6. **Add collapse animation** - Smooth transitions when toggling

### Long-Term Considerations

7. **Responsive breakpoints** - Different layouts for narrow windows
8. **Panel memory** - Remember which panels were open per document
9. **Double-click to collapse** - Click handle to fully collapse a panel

## Files Referenced

| File | Purpose |
|------|---------|
| `src/main/index.ts` | Window creation, size constraints |
| `src/main/menu.ts` | Menu definition, keyboard shortcuts |
| `src/renderer/components/layout/App.tsx` | Panel layout, auto-close logic |
| `src/renderer/components/layout/Toolbar.tsx` | Panel toggle buttons |
| `src/renderer/components/ui/resizable.tsx` | Panel library wrapper |
| `src/renderer/stores/chatStore.ts` | Chat panel state |
| `src/renderer/stores/fileListStore.ts` | File list panel state |
| `src/renderer/hooks/useChat.ts` | Chat panel hook |
| `src/renderer/hooks/useFileList.ts` | File list panel hook |
