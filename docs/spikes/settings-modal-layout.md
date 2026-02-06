# SPIKE: Settings Modal Layout and Scrolling

## Summary

The Settings dialog has layout issues when the window is smaller than the dialog content. Content can overflow off-screen with no way to access it. This document analyzes the current implementation and proposes solutions.

## Problem Statement

The Settings modal:

1. Has a fixed width (`max-w-2xl` = 672px) but **no height constraints**
2. Contains 5 tabs with varying content heights
3. Some tabs (especially Integrations) have expandable sections that increase height dynamically
4. On smaller windows or when many sections are expanded, content extends off the bottom of the viewport
5. There is no scrolling mechanism to access off-screen content

## Current Architecture

### Dialog Component

**Source:** `src/renderer/components/ui/dialog.tsx`

```tsx
<DialogPrimitive.Content
  className={cn(
    "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg ...",
    className
  )}
>
```

**Key properties:**

- Position: `fixed` at center (`left-[50%] top-[50%]`)
- Transform: `translate-x-[-50%] translate-y-[-50%]`
- Default width: `max-w-lg` (512px)
- **No height constraint**
- **No overflow handling**

### Settings Dialog

**Source:** `src/renderer/components/settings/SettingsDialog.tsx`

```tsx
<DialogContent className="max-w-2xl">
  <DialogHeader>...</DialogHeader>
  <Tabs>
    <TabsList className="grid w-full grid-cols-5">...</TabsList>
    <TabsContent value="general" className="space-y-4 mt-4">...</TabsContent>
    <TabsContent value="editor" className="space-y-6 mt-4">...</TabsContent>
    <TabsContent value="llm" className="space-y-4 mt-4">...</TabsContent>
    <TabsContent value="integrations" className="space-y-4 mt-4">...</TabsContent>
    <TabsContent value="account" className="space-y-4 mt-4">...</TabsContent>
  </Tabs>
  <Separator />
  <div className="flex justify-end gap-2">
    <Button>Cancel</Button>
    <Button>Save Changes</Button>
  </div>
</DialogContent>
```

**Properties:**

- Width: `max-w-2xl` (672px)
- **No max-height**
- **No overflow**
- Tab content grows unbounded

### Comparison: Working Example

**Source:** `src/renderer/components/settings/KeyboardShortcutsDialog.tsx`

```tsx
<DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
```

This dialog correctly handles overflow with:

- `max-h-[80vh]` - Limits height to 80% of viewport
- `overflow-y-auto` - Enables vertical scrolling when needed

## Tab Content Analysis

### Height Estimates (at 1200×800 window)

TabApproximate HeightNotes**General**\~520pxTheme + Recovery + Save Location + Autosave + Separator + Default Editor**Editor**\~280pxFont Size + Line Height + Font Family**LLM**\~350pxProvider + Model + API Key (with validation UI)**Integrations**\~700px+MCP (\~230px) + Separator + reMarkable (\~470px expanded)**Account**\~320pxGoogle Docs connection status + info boxes

### Dialog Chrome Height

ElementHeightDialogHeader\~32pxTabsList\~40pxGap (mt-4)\~16pxSeparator\~16pxButton row\~40pxPadding (p-6)48px (24px top + 24px bottom)**Total chrome\~192px**

### Available Content Height

At minimum window height (600px):

- Available for content: `600 - 192 = ~408px`
- But dialog is centered, so even less is visible

At default window height (800px):

- Available: `800 - 192 = ~608px`
- Integrations tab (\~700px) overflows

## Root Causes

### 1. No Max-Height on Dialog

The dialog grows with content, potentially extending off-screen.

### 2. No Overflow Handling

Even if content overflows, there's no scroll container.

### 3. Fixed Center Positioning

```css
top: 50%;
transform: translateY(-50%);
```

When dialog is taller than viewport, equal amounts overflow top and bottom - making both header and buttons inaccessible.

### 4. Dynamic Content Sections

The Integrations tab has conditionally rendered content:

- MCP info box (\~100px when not installed)
- reMarkable registration form (\~150px when not connected)
- reMarkable sync directory + API key + buttons (\~200px when connected)

These can add significant height without the dialog adapting.

## Proposed Solutions

### Option A: Simple Overflow (Quick Fix)

Add height constraints to the dialog:

```tsx
<DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
```

**Pros:**

- Simple, one-line change
- Consistent with KeyboardShortcutsDialog pattern
- Works immediately

**Cons:**

- Entire dialog scrolls, including header and buttons
- Buttons may scroll out of view while filling forms

### Option B: Scrollable Tab Content (Better UX)

Keep header and buttons fixed, scroll only tab content:

```tsx
<DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
  <DialogHeader className="flex-shrink-0">...</DialogHeader>
  <Tabs className="flex-1 min-h-0 flex flex-col">
    <TabsList className="flex-shrink-0">...</TabsList>
    <TabsContent className="flex-1 overflow-y-auto">
      ...
    </TabsContent>
  </Tabs>
  <Separator className="flex-shrink-0" />
  <div className="flex-shrink-0">
    <Button>Cancel</Button>
    <Button>Save Changes</Button>
  </div>
</DialogContent>
```

**Pros:**

- Header and buttons always visible
- Better form UX (can always click Save)
- More polished feel

**Cons:**

- More complex CSS
- Need to handle each TabsContent separately
- `min-h-0` hack required for flex children overflow

### Option C: Sidebar Navigation (Redesign)

Replace tabs with a sidebar layout:

```
┌─────────────────────────────────────────────────┐
│ Settings                               [X]      │
├──────────┬──────────────────────────────────────┤
│ General  │ Theme: [Dark ▾]                      │
│ Editor   │                                      │
│ LLM      │ Recovery: [Auto-recover ▾]           │
│ Integ... │ Choose how to handle unsaved work... │
│ Account  │                                      │
│          │ Default Save Location:               │
│          │ [~/Documents        ] [Browse...]    │
│          │                                      │
│          │ ─────────────────────                │
│          │                                      │
│          │ □ Autosave                           │
│          │                                      │
├──────────┴──────────────────────────────────────┤
│                    [Cancel] [Save Changes]      │
└─────────────────────────────────────────────────┘
```

**Pros:**

- Sidebar can be fixed, content scrolls naturally
- Room for more sections in the future
- Common pattern (VS Code, system preferences)

**Cons:**

- Significant redesign effort
- Needs wider dialog or tighter content

### Option D: Responsive Behavior

Adapt layout based on window size:

```tsx
// Use a hook to detect available space
const dialogHeight = useWindowHeight() * 0.85
const useCompactLayout = dialogHeight < 500

// Render compact or full layout
{useCompactLayout ? <CompactSettings /> : <FullSettings />}
```

**Pros:**

- Optimal UX at all sizes
- Could collapse sections, use accordions, etc.

**Cons:**

- Most complex to implement
- Two layouts to maintain

## Recommendation

**Short-term (Option A):** Add `max-h-[85vh] overflow-y-auto` to SettingsDialog for immediate relief.

**Medium-term (Option B):** Refactor to scroll only tab content, keeping header and buttons fixed.

**Long-term consideration (Option C):** If settings grow significantly, consider sidebar navigation.

## Files to Modify

FileChange`src/renderer/components/settings/SettingsDialog.tsx`Add height/overflow constraints`src/renderer/components/ui/dialog.tsx`(Optional) Add variant for scrollable dialogs

## Implementation Notes

### Flexbox Scrolling Pattern

For Option B, the key CSS pattern is:

```css
.dialog-content {
  display: flex;
  flex-direction: column;
  max-height: 85vh;
}

.scrollable-area {
  flex: 1;
  min-height: 0; /* Critical! Allows flex child to shrink */
  overflow-y: auto;
}

.fixed-area {
  flex-shrink: 0;
}
```

### Testing Checklist

- \[ \] 800×600 window (minimum size)
- \[ \] 1200×800 window (default size)
- \[ \] Integrations tab with reMarkable expanded
- \[ \] Integrations tab with MCP info box expanded
- \[ \] LLM tab with API key validation errors visible
- \[ \] General tab with autosave slider visible