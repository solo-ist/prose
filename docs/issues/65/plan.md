# Issue #65: Refine Keyboard Shortcuts - Implementation Plan

## Overview

This document outlines the implementation plan for refining keyboard shortcuts in Prose based on a comprehensive audit and comparison with similar applications (Obsidian, VS Code, Google Docs, iA Writer).

## Current State

See full audit in the issue comment. Key findings:
- 26 shortcuts currently implemented
- 1 undocumented shortcut (`Cmd+Shift+C`)
- 2 shortcut conflicts with industry standards
- 1 inconsistency in documentation

## Implementation Phases

### Phase 1: Quick Wins (Easy implementations)

#### 1.1 Documentation Fixes
- [ ] Add `Cmd+Shift+C` to KeyboardShortcutsDialog
- [ ] Remove or implement `Cmd+\` for chat toggle (currently only documented, not implemented)

#### 1.2 Text Formatting
- [ ] Implement `Cmd+U` - Underline (TipTap underline extension)
- [ ] Implement `Cmd+Shift+X` - Strikethrough (TipTap strike extension)

#### 1.3 Editor Navigation
- [ ] Implement `Cmd+G` - Go to line (dialog + selection)
- [ ] Implement `Cmd+]` / `Cmd+[` - Indent/outdent

### Phase 2: Shortcut Conflicts Resolution

#### 2.1 Conflict: `Cmd+K`
- **Current:** Toggle full context in chat
- **Standard:** Insert/edit link
- **Resolution:**
  - Implement `Cmd+K` for link insertion (TipTap Link command)
  - Move "toggle full context" to `Cmd+Alt+F` or remove if redundant
  - Update chat shortcuts accordingly

#### 2.2 Conflict: `Cmd+Shift+K`
- **Current:** Add selection as context
- **Standard:** Delete line
- **Resolution:**
  - Change `Cmd+Shift+K` to delete line
  - Deprecate `Cmd+Shift+Backspace` (non-standard)
  - Move "add selection as context" to `Cmd+Shift+A` (Add)
  - Update documentation

### Phase 3: Medium Complexity Features

#### 3.1 Line Manipulation
- [ ] Implement `Alt+Up/Down` - Move line up/down
- [ ] Implement `Cmd+Enter` - Insert line below (consider conflict with chat)
- [ ] Implement `Cmd+Shift+Enter` - Insert line above

#### 3.2 Find and Replace
- [ ] Extend FindBar component to support replace mode
- [ ] Implement `Cmd+H` - Open find and replace
- [ ] Add replace UI and functionality

#### 3.3 Tab Navigation
- [ ] Implement `Cmd+1-9` - Switch to tab N
- [ ] Implement `Cmd+Tab` / `Cmd+Shift+Tab` - Next/previous tab

### Phase 4: Complex Features (Future)

#### 4.1 Command Palette
- [ ] Design command palette UI component
- [ ] Implement fuzzy search for commands and files
- [ ] Implement `Cmd+P` - Open command palette
- [ ] Add command registration system

#### 4.2 Global Search
- [ ] Enhance file list panel with search capability
- [ ] Implement `Cmd+Shift+F` - Search in all files
- [ ] Add search results UI

## Technical Implementation Notes

### File Locations
- Keyboard shortcuts dialog: `src/renderer/components/settings/KeyboardShortcutsDialog.tsx`
- Editor keyboard handlers: `src/renderer/components/editor/Editor.tsx`
- Menu accelerators: `src/main/menu.ts`
- TipTap extensions: `src/renderer/extensions/` or inline in Editor.tsx

### Testing Approach
Since there's no test suite, testing will be manual:
1. Test on macOS and Windows (if possible)
2. Verify shortcuts in both Electron and browser modes
3. Check for conflicts with browser/OS shortcuts
4. Verify shortcuts appear in dialog
5. Test with file list and chat panel open/closed

### Breaking Changes
Phase 2 includes breaking changes to existing shortcuts:
- `Cmd+K` functionality changes
- `Cmd+Shift+K` functionality changes
- Consider migration guide or temporary dual-support period

## Acceptance Criteria

### Phase 1
- [ ] All documented shortcuts have implementations
- [ ] All implementations appear in shortcuts dialog
- [ ] Basic formatting shortcuts work (underline, strikethrough)
- [ ] Go to line dialog functions correctly
- [ ] Indent/outdent work on lists and paragraphs

### Phase 2
- [ ] Shortcut conflicts resolved
- [ ] Link insertion works via `Cmd+K`
- [ ] Delete line uses standard `Cmd+Shift+K`
- [ ] No regressions in existing functionality
- [ ] Updated documentation reflects changes

### Phase 3
- [ ] Line movement works reliably
- [ ] Find and replace UI is intuitive
- [ ] Tab navigation shortcuts work
- [ ] All shortcuts are documented

### Phase 4
- [ ] Command palette is fast and responsive
- [ ] Global search returns relevant results
- [ ] UX is comparable to VS Code/Obsidian

## Timeline Estimate

- **Phase 1:** 2-3 hours
- **Phase 2:** 3-4 hours
- **Phase 3:** 8-10 hours
- **Phase 4:** 20+ hours (separate epic)

## Decision Points

1. **Cmd+K conflict:** Proceed with link insertion as standard?
2. **Cmd+Shift+K conflict:** Proceed with standardization?
3. **Command palette:** Include in this issue or create separate issue?
4. **Breaking changes:** Announce to users or silent migration?

## References

- Issue: #65
- Audit: See issue comment
- TipTap docs: https://tiptap.dev/
- VS Code shortcuts: https://code.visualstudio.com/docs/getstarted/keybindings
- Obsidian shortcuts: https://help.obsidian.md/
