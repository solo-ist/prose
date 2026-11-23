/**
 * What a remote MCP client may do (#1239; design docs/architecture/mcp-relay.md
 * §5): the desktop's copy of the gateway's table (gateway/src/relay/scopes.ts),
 * which remoteScopes.test.ts keeps identical.
 *
 * Remote clients (ChatGPT, claude.ai, through the relay) get less than local
 * ones: tools on the documents the writer has open, never the filesystem,
 * never the writer's decisions. `propose` and `comment` each include `read`.
 * Never remote: `open_file`, `create_and_open_file`, `select_tab`, accept and
 * reject (#607).
 */

export const REMOTE_SCOPES = ['read', 'propose', 'comment'] as const
export type RemoteScope = (typeof REMOTE_SCOPES)[number]

export const REMOTE_SCOPE_TOOLS: Record<RemoteScope, readonly string[]> = {
  read: [
    'list_tabs',
    'read_document',
    'get_outline',
    'list_comments',
    'list_suggestions',
    'get_review_status',
    'list_review_events',
  ],
  propose: ['suggest_edit', 'suggest_insert', 'suggest_delete', 'revise_suggestion', 'reply_to_suggestion'],
  comment: ['add_comment', 'reply_to_comment', 'resolve_comment', 'reopen_comment'],
}

/** Every tool any remote scope reaches. */
export const REMOTE_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(REMOTE_SCOPE_TOOLS).flat())

export function isRemoteScope(value: unknown): value is RemoteScope {
  return typeof value === 'string' && (REMOTE_SCOPES as readonly string[]).includes(value)
}

/** The remote scopes in a list (anything else is dropped), in table order, deduplicated. */
export function remoteScopesOf(values: readonly unknown[]): RemoteScope[] {
  return REMOTE_SCOPES.filter((s) => values.includes(s))
}

/** Every tool the given scopes reach (`propose` and `comment` include `read`). */
export function toolsForRemoteScopes(scopes: readonly RemoteScope[]): Set<string> {
  const tools = new Set<string>()
  if (scopes.length === 0) return tools
  for (const tool of REMOTE_SCOPE_TOOLS.read) tools.add(tool)
  for (const scope of scopes) for (const tool of REMOTE_SCOPE_TOOLS[scope]) tools.add(tool)
  return tools
}
