# SPIKE: Claude Desktop Extension Feasibility

## Summary

This document captures the results of a spike investigation into the feasibility and complexity of building a Claude Desktop Extension for Prose.

## What are Claude Desktop Extensions?

Claude Desktop Extensions (formerly DXT, now MCPB - MCP Bundles) are packaged MCP (Model Context Protocol) servers that provide Claude Desktop with access to local tools, resources, and prompts. They are distributed as `.mcpb` files (zip archives containing the server code and a `manifest.json`).

### Key Characteristics:
- **Format**: `.mcpb` zip archives containing manifest.json + server code
- **Runtime**: Supports Node.js (bundled with Claude Desktop), Python, or native binaries
- **Communication**: Uses stdio (standard input/output) with JSON-RPC 2.0
- **Capabilities**: Can expose Tools (actions), Resources (data), and Prompts (templates)
- **Installation**: One-click installation via Claude Desktop Settings > Extensions

## Extension Architecture

```
Claude Desktop
    │
    └── Launches MCP Server (subprocess)
            │ (stdio JSON-RPC)
            ▼
        Prose Extension
            ├── Tools (read/write documents)
            ├── Resources (document content, chat history)
            └── Prompts (editing templates)
```

## Potential Integration Approaches

### Option A: Standalone File-Based Extension (Recommended for MVP)

**Description**: Extension operates independently, accessing Prose data files directly without requiring a running Prose instance.

**Capabilities**:
- Read/write markdown files from user's filesystem
- Access Prose settings from `~/.prose/settings.json`
- Access conversation history from `~/.prose/conversations/`
- Create new documents in default Prose directories

**Pros**:
- ✅ Simple to implement
- ✅ No IPC complexity
- ✅ Works whether Prose is running or not
- ✅ Can leverage Node.js bundled with Claude Desktop

**Cons**:
- ⚠️ No live interaction with open Prose editor
- ⚠️ Changes require manual refresh in Prose
- ⚠️ Limited to file operations only

**Estimated Effort**: 1-2 days for basic implementation

### Option B: IPC Bridge with Running Prose Instance

**Description**: Extension communicates with a running Prose instance through a local IPC mechanism (HTTP server, WebSocket, or Unix socket).

**Capabilities**:
- All of Option A, plus:
- Live document manipulation in open editor
- Real-time diff suggestions
- Access to current cursor position and selection
- Trigger UI actions (apply edits, scroll to location)

**Pros**:
- ✅ Full integration with running Prose
- ✅ Can leverage Prose's diff/suggestion UI
- ✅ Real-time collaboration between Claude and Prose

**Cons**:
- ⚠️ Requires Prose to expose local API server
- ⚠️ More complex architecture
- ⚠️ Security considerations for local API
- ⚠️ Only works when Prose is running

**Estimated Effort**: 3-5 days (includes adding local server to Prose)

### Option C: Embedded MCP Server in Prose

**Description**: Prose itself hosts an MCP server, allowing Claude Desktop to connect directly.

**Pros**:
- ✅ Tightest integration possible
- ✅ Full access to Prose internals

**Cons**:
- ⚠️ Requires significant Prose architecture changes
- ⚠️ MCP typically uses stdio, complex in Electron context
- ⚠️ Would require Prose to always be running

**Estimated Effort**: 5-10 days

## Recommended Implementation Plan

### Phase 1: MVP Extension (Option A)

Build a standalone extension that provides:

#### Tools:
| Tool | Description |
|------|-------------|
| `prose_read_document` | Read a markdown file's content |
| `prose_write_document` | Write/update a markdown file |
| `prose_list_documents` | List recent/known documents |
| `prose_get_settings` | Read Prose configuration |
| `prose_search_documents` | Search across documents |

#### Resources:
| Resource | Description |
|----------|-------------|
| `prose://settings` | Current Prose settings |
| `prose://recent` | List of recent documents |
| `prose://document/{path}` | Document content |

#### Prompts:
| Prompt | Description |
|--------|-------------|
| `prose_edit` | Structured editing prompt with SEARCH/REPLACE format |
| `prose_review` | Document review and feedback prompt |

### Phase 2: Enhanced Integration (Option B)

Add a local API server to Prose and upgrade the extension:

```typescript
// In Prose main process
const server = createServer((req, res) => {
  // Handle extension requests
});
server.listen(PROSE_LOCAL_PORT);
```

Additional capabilities:
- `prose_apply_diff` - Apply SEARCH/REPLACE directly in editor
- `prose_get_selection` - Get current selection/cursor
- `prose_insert_suggestion` - Create inline suggestion

## Technical Requirements

### Dependencies:
```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "zod": "^3.25.0"
}
```

### Manifest Structure:
```json
{
  "manifest_version": "0.3",
  "name": "prose-editor",
  "display_name": "Prose Editor",
  "version": "1.0.0",
  "description": "AI-powered markdown editing with Prose",
  "author": { "name": "Prose Team" },
  "server": {
    "type": "node",
    "entry_point": "dist/server.js"
  },
  "tools": [
    { "name": "prose_read_document" },
    { "name": "prose_write_document" },
    { "name": "prose_list_documents" }
  ],
  "user_config": [
    {
      "name": "prose_documents_dir",
      "type": "directory",
      "title": "Documents Directory",
      "description": "Default directory for Prose documents"
    }
  ]
}
```

### Build & Package:
```bash
npm install -g @anthropic-ai/mcpb
mcpb init    # Generate manifest.json
mcpb pack    # Create .mcpb bundle
```

## Complexity Assessment

| Aspect | Complexity | Notes |
|--------|-----------|-------|
| MCP SDK Learning Curve | Low | Well-documented, TypeScript support |
| Tool Implementation | Low-Medium | Straightforward file operations |
| Resource Implementation | Low | Simple data exposure |
| Manifest Configuration | Low | Template-based setup |
| Testing | Medium | Requires Claude Desktop for integration testing |
| Distribution | Low | Single `.mcpb` file |

**Overall Complexity: LOW-MEDIUM**

The extension can be built incrementally, starting with basic file operations and adding more sophisticated features over time.

## Feasibility Verdict

**✅ FEASIBLE** - Building a Claude Desktop Extension for Prose is straightforward and well-supported by existing tooling.

### Key Advantages:
1. **Node.js bundled with Claude Desktop** - No runtime dependencies for users
2. **Official SDK and tooling** - `@anthropic-ai/mcpb` CLI for packaging
3. **Open specification** - MCPB format is open source and well-documented
4. **Prose architecture is compatible** - Existing file-based storage works well

### Recommended Next Steps:
1. Create basic extension project structure
2. Implement core file operation tools
3. Test with Claude Desktop manually
4. Add resource and prompt support
5. Package as `.mcpb` and distribute

## References

- [Anthropic Desktop Extensions Blog Post](https://www.anthropic.com/engineering/desktop-extensions)
- [MCPB GitHub Repository](https://github.com/anthropics/mcpb)
- [Model Context Protocol Documentation](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [TypeScript SDK for MCP](https://github.com/modelcontextprotocol/typescript-sdk)
- [Claude Help: Getting Started with Local MCP Servers](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
