// @vitest-environment node
/** The remote scope table (#1239) matches the gateway's and stays inside the MCP tool list. */
import { describe, expect, it } from 'vitest'
import { REMOTE_SCOPES, REMOTE_SCOPE_TOOLS, REMOTE_TOOL_NAMES, remoteScopesOf, toolsForRemoteScopes } from './remoteScopes'
import { RELAY_SCOPES, RELAY_SCOPE_TOOLS } from '../../../gateway/src/relay/scopes'
import { mcpToolNames } from '../tools/registry'

describe('remote scopes', () => {
  it('is the gateway table, scope for scope and tool for tool', () => {
    expect([...REMOTE_SCOPES]).toEqual([...RELAY_SCOPES])
    for (const scope of REMOTE_SCOPES) expect([...REMOTE_SCOPE_TOOLS[scope]]).toEqual([...RELAY_SCOPE_TOOLS[scope]])
  })

  it('names only MCP tools, and never the filesystem, the view or the writer’s decisions', () => {
    for (const tool of REMOTE_TOOL_NAMES) expect(mcpToolNames, tool).toContain(tool)
    for (const never of ['open_file', 'create_and_open_file', 'select_tab', 'accept_diff', 'reject_diff']) {
      expect(REMOTE_TOOL_NAMES.has(never), never).toBe(false)
    }
  })

  it('propose and comment include read; nothing reaches nothing', () => {
    expect(toolsForRemoteScopes([])).toEqual(new Set())
    const propose = toolsForRemoteScopes(['propose'])
    expect(propose.has('read_document') && propose.has('suggest_edit') && !propose.has('add_comment')).toBe(true)
    // Tracked changes are proposals too (#891): propose only.
    for (const tool of ['suggest_insert', 'suggest_delete']) {
      expect(propose.has(tool), tool).toBe(true)
      expect(toolsForRemoteScopes(['read']).has(tool) || toolsForRemoteScopes(['comment']).has(tool), tool).toBe(false)
    }
    const comment = toolsForRemoteScopes(['comment'])
    expect(comment.has('list_comments') && comment.has('add_comment') && !comment.has('suggest_edit')).toBe(true)
    expect(remoteScopesOf(['comment', 'admin', 'read', 'read'])).toEqual(['read', 'comment'])
  })
})
