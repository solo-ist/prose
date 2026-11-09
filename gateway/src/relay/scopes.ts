/**
 * relay/scopes.ts — what a remote MCP client may do (#1238, design §5).
 *
 * Remote clients get less than local ones: tools on the documents the writer
 * has open, never the filesystem, never the writer's decisions. The OAuth
 * scopes are `read`, `propose` and `comment`; `propose` and `comment` each
 * include `read`. The desktop enforces the same table (the writer's approval
 * in the app is the second gate); the gateway filters `tools/list` and refuses
 * an out-of-scope `tools/call` before forwarding it, so a desktop bug alone
 * can't widen what a token reaches.
 *
 * Never remote, and so absent here: `open_file`, `create_and_open_file`,
 * `select_tab` (a cloud client must not open local files or move the
 * writer's view), and accept / reject (the writer always decides, #607).
 * A tool the gateway doesn't know is refused: a new desktop tool reaches
 * remote clients only once it is added to this table.
 *
 * Pure (no imports), so the desktop's copy can be checked against it.
 */

export const RELAY_SCOPES = ['read', 'propose', 'comment'] as const
export type RelayScope = (typeof RELAY_SCOPES)[number]

export const RELAY_SCOPE_TOOLS: Record<RelayScope, readonly string[]> = {
  read: [
    'list_tabs',
    'read_document',
    'get_outline',
    'list_comments',
    'list_suggestions',
    'get_review_status',
    'list_review_events',
  ],
  propose: ['suggest_edit', 'revise_suggestion', 'reply_to_suggestion'],
  comment: ['add_comment', 'reply_to_comment', 'resolve_comment', 'reopen_comment'],
}

/** The relay scopes in a space-separated OAuth `scope` string; anything else is dropped. */
export function relayScopesOf(scope: string | undefined | null): RelayScope[] {
  const granted = new Set((scope ?? '').split(/\s+/).filter(Boolean))
  return RELAY_SCOPES.filter((s) => granted.has(s))
}

/** Every tool the given scopes reach (`propose` and `comment` include `read`). */
export function toolsForScopes(scopes: readonly RelayScope[]): Set<string> {
  const tools = new Set<string>()
  if (scopes.length === 0) return tools
  for (const tool of RELAY_SCOPE_TOOLS.read) tools.add(tool)
  for (const scope of scopes) for (const tool of RELAY_SCOPE_TOOLS[scope]) tools.add(tool)
  return tools
}
