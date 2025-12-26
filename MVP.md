# Prose MVP Specification

A minimal AI chat app with integrated todo list functionality, invoked via tool calls and rendered as interactive React components.

## Core Concept

Think: Claude meets Todoist. A persistent chat interface where the AI can create, manage, and display todo lists through tool calls. The UI renders these as interactive components users can manipulate directly.

---

## MVP Scope

### 1. Persistent Chat Sessions

- **Session storage**: Chat history persisted locally (IndexedDB or file-based via Electron)
- **Session list**: Sidebar showing past conversations
- **New/delete sessions**: Basic session management
- **Context preservation**: Full conversation history sent to LLM (with reasonable token limits)

### 2. Todo List via Tool Calls

The AI has access to todo tools that render as interactive React components:

#### Tools

| Tool | Description |
|------|-------------|
| `create_todo` | Create a new todo item |
| `list_todos` | Display current todos as a component |
| `update_todo` | Mark complete, edit text, change priority |
| `delete_todo` | Remove a todo |

#### Todo Schema

```typescript
interface Todo {
  id: string
  text: string
  completed: boolean
  priority?: 'low' | 'medium' | 'high'
  dueDate?: string
  createdAt: Date
  updatedAt: Date
}
```

#### Rendered Components

When the AI calls `list_todos` or `create_todo`, the message includes an interactive `<TodoList>` component:
- Checkboxes to toggle completion
- Inline editing
- Delete buttons
- Priority badges
- Due date display

User interactions on these components update the todo store directly (no need to ask the AI).

### 3. Command System

#### Slash Commands (`/`)

Quick actions the user types directly:

| Command | Action |
|---------|--------|
| `/new` | Start a new chat session |
| `/clear` | Clear current session |
| `/todos` | Show all todos (renders component) |
| `/help` | Show available commands |

#### @ Mentions (Future - Out of MVP)

Plugin system for context injection:
- `@doc` - Include current document
- `@web` - Web search
- `@file` - Attach a file

*Note: @ commands are OUT OF SCOPE for MVP. Documenting for future reference.*

---

## Architecture

### State Management

```
stores/
├── chatStore.ts      # Messages, sessions, active session
├── todoStore.ts      # Todo items, CRUD operations
└── settingsStore.ts  # LLM config, preferences (existing)
```

### Tool Call Flow

1. User sends message
2. LLM responds with tool calls (e.g., `create_todo`)
3. Tool calls are executed against `todoStore`
4. Results rendered as React components in the message
5. User can interact with components directly

### Data Persistence

- **Chat sessions**: `~/.prose/sessions/` (JSON files per session)
- **Todos**: `~/.prose/todos.json`
- **Settings**: `~/.prose/settings.json` (existing)

---

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│  Prose                                    [Settings] │
├──────────────┬──────────────────────────────────────┤
│              │                                      │
│  Sessions    │   Chat Messages                      │
│              │                                      │
│  > Today     │   ┌────────────────────────────────┐ │
│    Yesterday │   │ User: Add a todo to buy milk   │ │
│    Project X │   └────────────────────────────────┘ │
│              │   ┌────────────────────────────────┐ │
│  [+ New]     │   │ Assistant: Created!            │ │
│              │   │ ┌──────────────────────────┐   │ │
│              │   │ │ ☐ Buy milk         [x]   │   │ │
│              │   │ └──────────────────────────┘   │ │
│              │   └────────────────────────────────┘ │
│              │                                      │
│              ├──────────────────────────────────────┤
│              │  [Type a message... ]      [Send]    │
└──────────────┴──────────────────────────────────────┘
```

---

## Out of Scope (MVP)

- Markdown editor (defer TipTap integration)
- @ mention plugins
- File attachments
- Web search
- Suggested edits / diff view
- Streaming responses (collect full response first)
- Multiple todo lists / projects
- Todo sync across devices

---

## GitHub Issues Breakdown

### Milestone: MVP v0.1

#### Chat Infrastructure
1. **Persistent chat sessions** - Store/load sessions from disk
2. **Session sidebar** - List, create, delete sessions
3. **Chat UI refinements** - Polish existing chat components

#### Todo System
4. **Todo store** - Zustand store with CRUD operations
5. **Todo persistence** - Save/load todos to disk
6. **Todo components** - `<TodoList>`, `<TodoItem>` interactive components
7. **Todo tools** - Define `create_todo`, `list_todos`, `update_todo`, `delete_todo`
8. **Wire up tool calls** - Execute tools in IPC, render results in UI

#### Commands
9. **Slash command parser** - Parse `/command` from input
10. **Implement core commands** - `/new`, `/clear`, `/todos`, `/help`

#### Polish
11. **Error handling** - Graceful failures for LLM/storage errors
12. **Loading states** - Proper loading indicators
13. **Keyboard shortcuts** - Cmd+N (new session), Cmd+K (command palette?)

---

## Success Criteria

MVP is complete when a user can:

1. Start a new chat session
2. Ask the AI to "create a todo for buying groceries"
3. See an interactive todo component rendered in the chat
4. Check off the todo directly in the UI
5. Close the app, reopen, and see their session + todos preserved
