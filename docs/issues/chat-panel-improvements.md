# Chat Panel Improvements: "Claude Code for Writing"

## Summary

Transform the chat panel from a simple SEARCH/REPLACE editor into a full application controller. Tools become the unified API surface - Claude can invoke them autonomously, or users can invoke them via slash commands. The app "seamlessly morphs" to support whatever the AI is doing.

## Motivation

The current chat panel feels deficient compared to modern AI writing assistants. It has one capability (SEARCH/REPLACE editing) implemented via text parsing, no multi-step workflows, and Claude can't decide when to read vs edit vs just respond. We want something closer to "Cursor for writing" or "Claude Code for writing."

## Architecture

### Unified Tool System

```
┌─────────────────────────────────────────────────────────────────┐
│                     SLASH COMMANDS (User-facing)                 │
│  /edit  /critique  /expand  /outline  /highlight  /help          │
│  (aliases + workflows built on tools)                            │
├─────────────────────────────────────────────────────────────────┤
│                     MODE LAYER                                   │
│  Full Autonomy │ Suggestions Only │ Plan Mode                    │
│  (edit, comment, highlight all available)                        │
│                │ (read + comment + highlight only)               │
│                                    │ (proposes, user approves)   │
├─────────────────────────────────────────────────────────────────┤
│                     TOOLS (Claude-callable)                      │
│  Document    │  Application UI  │  File System  │  Read-only     │
│  ──────────  │  ──────────────  │  ──────────── │  ──────────    │
│  edit        │  toggle_panel    │  open_file    │  read_document │
│  insert      │  highlight_text  │  list_files   │  read_selection│
│  add_comment │  show_toast      │  select_file  │  get_stats     │
│  format      │  scroll_to       │               │  search_doc    │
└─────────────────────────────────────────────────────────────────┘
```

## Tool Definitions

### Document Tools

| Tool | Description | Respects Mode |
|------|-------------|---------------|
| `edit` | Make SEARCH/REPLACE edits to document | Yes - disabled in Suggestions mode |
| `insert` | Insert text at cursor position | Yes - disabled in Suggestions mode |
| `add_comment` | Add inline comment to text range | Always available |
| `format` | Apply formatting (bold, italic, heading) | Yes - disabled in Suggestions mode |
| `suggest_edit` | Show edit suggestion without applying | Always available (used in Plan mode) |

### Application UI Tools

| Tool | Description | Implementation |
|------|-------------|----------------|
| `toggle_panel` | Open/close file list or chat | `fileListStore.togglePanel()`, `chatStore.togglePanel()` |
| `highlight_text` | Temporarily highlight text range (visual only) | New: decoration in TipTap |
| `scroll_to` | Scroll editor to line/text/position | New: `editor.commands.scrollIntoView()` |
| `show_toast` | Display notification toast | New: toast component |
| `focus_editor` | Return focus to editor | `editor.commands.focus()` |

### File System Tools

| Tool | Description | Implementation |
|------|-------------|----------------|
| `open_file` | Open a file by path | `useEditor.openFileFromPath()` |
| `list_files` | List files in current folder/recent | `fileListStore.getFiles()` |
| `select_file` | Highlight a file in the explorer | `fileListStore.selectFile()` |
| `new_file` | Create new document | `useEditor.newFile()` |

### Read-Only Tools (always available)

| Tool | Description | Implementation |
|------|-------------|----------------|
| `read_document` | Get full document content | `editorStore.document.content` |
| `read_selection` | Get currently selected text | `editor.state.selection` |
| `get_stats` | Word count, character count, etc. | Computed from content |
| `search_doc` | Find text/regex in document | Text search |
| `get_outline` | Get document structure (headings) | Parse heading nodes |

## Mode System

### Suggestions Mode (Default)
- Read-only + `add_comment` + `highlight_text` + `suggest_edit`
- Cannot directly edit document
- Perfect for feedback/critique workflows
- AI can still "point at things" and annotate
- Safer default for new users

### Full Autonomy
- All tools available
- Edits apply directly (like current "Agent Mode")
- For confident users who want speed

### Plan Mode
- Proposes changes, user must approve
- Uses `suggest_edit` to show diffs
- Multi-step plans shown in chat
- User clicks "Apply" to execute

**UI indicator**: Mode badge in chat header or status bar

## Slash Commands

| Command | Tools | Prompt Focus | Mode |
|---------|-------|--------------|------|
| `/edit` | All document tools | "Make edits as requested" | Full |
| `/critique` | Read + comment + highlight | "Provide feedback without editing" | Suggestions |
| `/expand` | edit, insert | "Expand on the selected text" | Full |
| `/outline` | read, edit, get_outline | "Improve document structure" | Plan |
| `/help` | (none) | Built-in help | - |

## LLM Integration Changes

### Current Flow
```
User message → System prompt → API call → Parse SEARCH/REPLACE → Apply
```

### New Flow
```
User message → System prompt + Tools → API call with tool_use
    ↓
Tool calls returned
    ↓
Execute tools (respecting mode)
    ↓
Return tool results to Claude
    ↓
Continue until done (or max iterations)
```

**Key change**: Use Claude's native `tool_use` feature instead of text parsing.

## New UI Components

### Tool Result Display (Context-Aware)

Different tools get different UI treatments in chat:

**Rich Tool Blocks** (clickable, interactive):
- `add_comment` → Shows comment preview, click jumps to location
- `suggest_edit` → Shows diff preview, click to accept/reject
- `edit` → Shows "Edited: [snippet]", click to see diff
- `open_file` → Shows filename, click to jump to file

**Subtle Action Lines** (glittery/animated):
- `highlight_text` → "✨ Highlighted: [text snippet]"
- `toggle_panel` → "✨ Opened file explorer"
- `scroll_to` → "✨ Scrolled to [location]"
- `focus_editor` → (silent, no display)

### Highlight Decoration
- Gradient background (warm yellow → transparent)
- Pulse/fade animation over ~3 seconds
- Multiple highlights supported with staggered timing
- Clicking chat tool block scrolls to and re-highlights

### Mode Indicator
- Badge/pill: "Suggestions" (default) | "Full" | "Plan"
- Visual distinction (Suggestions = blue, Full = green, Plan = orange)
- Click to cycle or dropdown to select

## Files to Modify

### Core Changes
- `src/main/ipc.ts` - Add tool_use support to LLM handler
- `src/renderer/hooks/useChat.ts` - Tool execution loop
- `src/renderer/lib/prompts.ts` - Tool-aware system prompts

### New Files
- `src/renderer/lib/tools/` - Tool definitions and executors
  - `definitions.ts` - Tool schemas
  - `executor.ts` - Tool dispatch
  - `document.ts` - Document tools
  - `ui.ts` - UI tools
  - `files.ts` - File tools
- `src/renderer/components/chat/ModeIndicator.tsx`
- `src/renderer/extensions/highlight/` - Temporary highlight extension

### Modified Components
- `src/renderer/components/chat/ChatInput.tsx` - Slash command handling
- `src/renderer/components/chat/ChatPanel.tsx` - Mode selector
- `src/renderer/stores/chatStore.ts` - Mode state

## Implementation Order

- [ ] **Phase 1: Tool infrastructure** - Definitions, executor, tool loop in useChat
- [ ] **Phase 2: Read-only tools** - read_document, read_selection, get_stats, search_doc
- [ ] **Phase 3: Document tools** - edit (migrate from SEARCH/REPLACE), insert, add_comment
- [ ] **Phase 4: UI tools** - toggle_panel, highlight_text, scroll_to
- [ ] **Phase 5: Mode system** - Suggestions mode, Plan mode
- [ ] **Phase 6: Slash commands** - /edit, /critique, /expand
- [ ] **Phase 7: File tools** - open_file, list_files, select_file

## Acceptance Criteria

### Tool System
- [ ] Ask Claude to "highlight the first paragraph" → should see highlight
- [ ] Ask Claude to "add a comment about the intro" → should see comment
- [ ] Ask Claude to "fix the typo in line 3" → should apply edit
- [ ] Switch to Suggestions mode, ask for edit → should show suggestion not apply

### Slash Commands
- [ ] Type `/help` → should show available commands
- [ ] Type `/critique` → should switch to suggestions mode and provide feedback
- [ ] Type `/expand` with selection → should expand that text

## Open Questions

1. **Max iterations** - How many tool loops before stopping? (Suggest: 10)
2. **Error handling** - What happens when a tool fails? (Suggest: inline error, continue if possible)
3. **Undo support** - Undo multiple tool actions as a group? (Suggest: defer to v2)
4. **Keyboard shortcuts** - Shortcut to cycle modes? (Suggest: Cmd+Shift+M)
