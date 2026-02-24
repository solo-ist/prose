# Issue #55: Frontmatter Editing Support — Investigation

## Current State

Prose has a read-only `FrontmatterDisplay` component that parses simple `key: value` YAML and renders a styled info box above the editor. There is no editing UI.

### Architecture

```
File on disk (.md with frontmatter)
         |
parseMarkdown() [markdown.ts — uses js-yaml]
         |
         +-- frontmatter: Record<string, unknown> --> editorStore.document.frontmatter
         +-- content: string --> TipTap editor (frontmatter stripped)

On save:
  TipTap markdown body + frontmatterRef string --> file
  OR serializeMarkdown(content, store.frontmatter) via js-yaml
```

Key: **TipTap never sees frontmatter.** It's stored in a `useRef<string>` and prepended on save.

### Two Parsers Problem

1. **`FrontmatterDisplay.tsx`**: Simple string splitting on `:` — only handles flat key-value pairs, all values as strings
2. **`markdown.ts`**: Proper YAML via `js-yaml` — handles nested objects, arrays, booleans, etc.

This mismatch is safe for read-only display but becomes a problem if editing is introduced.

### Fields Currently Used

- **`google_doc_id`** — Google Docs import provenance (displayed as link)
- **`google_synced_at`** — Timestamp of last Google Docs sync
- No reMarkable fields (uses separate metadata files)
- No custom user fields in active use

## Investigation Questions

### 1. Simple key-value editor vs full YAML support?

**Recommendation: Simple key-value editor (v1), with raw YAML escape hatch later.**

Rationale:
- Only 2 fields are actively used, both are simple strings
- Users importing from other tools (Hugo, Jekyll, Obsidian) may have complex YAML, but they mostly just need to see it, not edit nested structures
- Full YAML editing requires a code editor (Monaco, CodeMirror) — overkill for the common case
- A simple form with key/value inputs covers 90% of needs

### 2. Inline editing (in-document) vs modal/sidebar?

**Recommendation: Sidebar panel (same side as chat), triggered by clicking the frontmatter display.**

Inline editing breaks because:
- TipTap doesn't manage frontmatter — edits wouldn't trigger save/dirty tracking
- Tab switching loses unsaved edits (stored in ref, not TipTap state)
- YAML syntax errors would corrupt the file
- FrontmatterDisplay's simple parser would produce different results than js-yaml

Modal is fine but a sidebar panel integrates better with the existing UI pattern (chat panel, file list). Clicking the frontmatter display opens an editor panel.

### 3. TipTap extension vs separate React component?

**Recommendation: Separate React component.**

- Frontmatter is deliberately excluded from TipTap's document model
- Adding it as a TipTap extension would require custom Node serialization and special handling during markdown import/export
- The current architecture (ref + store) works well — just need a bidirectional editor component
- A React form component can read from `document.frontmatter` and write via `setFrontmatter()`

### 4. What frontmatter fields does Prose use?

Currently: `google_doc_id`, `google_synced_at` (both auto-populated).

Future candidates:
- `title` — override filename-derived title
- `tags` — document categorization (array)
- `created_at` / `updated_at` — timestamps
- Custom user fields — arbitrary key-value pairs

## Recommended Implementation

### Phase 1: Clickable key-value editor

1. **Replace `FrontmatterDisplay` with `FrontmatterEditor`**
   - Default state: current read-only display (collapsed info box)
   - Click to expand into editable form
   - Each key-value pair gets an input field
   - "Add field" button for new entries
   - Delete button (x) on each field

2. **Unify on js-yaml**
   - Remove the simple string parser in FrontmatterDisplay
   - Use `yaml.load()` / `yaml.dump()` everywhere
   - Handle non-string values gracefully (show type indicator)

3. **Wire to store**
   - Edit updates `document.frontmatter` via `setFrontmatter()`
   - Mark document dirty on edit
   - `serializeMarkdown()` already handles frontmatter → YAML string

### Phase 2 (Later): Advanced features

- Raw YAML toggle for power users (textarea with syntax highlighting)
- Template fields per project (define expected frontmatter schema)
- Auto-populate fields (created_at, updated_at on save)

## Risks

- **Quote handling**: FrontmatterDisplay strips quotes, js-yaml preserves them. Editing could introduce inconsistencies. Fix by unifying on js-yaml.
- **Data loss**: Currently tab-switch before debounce can lose frontmatter edits. Fix by writing frontmatter changes to store immediately (not via debounce).
- **Google Docs sync**: App re-reads frontmatter from disk as safety net. Editing could cause sync metadata to diverge. Low risk since Google Docs import is a one-time operation.

## Effort Estimate

- Phase 1: Small — modify FrontmatterDisplay, unify parser, wire to store
- Phase 2: Medium — raw YAML editor, templates, auto-populate
