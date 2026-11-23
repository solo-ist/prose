/**
 * The `document` target of an MCP call (#1237): an open tab by documentId or
 * path, never a reopen from disk; dropped on tools that take none.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const tabs = vi.hoisted(() => ({
  list: [] as Array<{ id: string; documentId: string; path: string | null }>,
}))

vi.mock('../../stores/tabStore', () => ({
  useTabStore: { getState: () => ({ tabs: tabs.list }) },
}))

import { splitMcpTarget } from './mcpTarget'
import { getToolsForMCP } from '../../../shared/tools/registry'

beforeEach(() => {
  tabs.list = [
    { id: 'tab-a', documentId: 'doc-a', path: '/Users/w/notes/a.md' },
    { id: 'tab-b', documentId: 'doc-b', path: null },
  ]
})

describe('splitMcpTarget', () => {
  it('passes arguments through untouched when there is no target', () => {
    const args = { nodeId: 'n1', content: 'x' }
    expect(splitMcpTarget('suggest_edit', args, 'mcp-1')).toEqual({ args })
  })

  it('resolves a documentId to its open tab, with no path to reopen', () => {
    expect(splitMcpTarget('add_comment', { document: 'doc-a', comment: 'c' }, 'mcp-2')).toEqual({
      args: { comment: 'c' },
      binding: { conversationId: 'mcp-2', documentId: 'doc-a', path: null, tabId: 'tab-a' },
    })
  })

  it('resolves a path to its open tab', () => {
    const result = splitMcpTarget('read_document', { document: '/Users/w/notes/a.md' }, 'mcp-3')
    expect(result).toMatchObject({ binding: { tabId: 'tab-a', documentId: 'doc-a', path: null } })
  })

  it('reaches an untitled tab by its documentId', () => {
    expect(splitMcpTarget('list_comments', { document: 'doc-b' }, 'mcp-4')).toMatchObject({ binding: { tabId: 'tab-b' } })
  })

  it('refuses a document that is not open, naming list_tabs and open_file', () => {
    const result = splitMcpTarget('add_comment', { document: '/Users/w/notes/closed.md', comment: 'c' }, 'mcp-5')
    expect('error' in result && result.error.success === false && result.error.code).toBe('DOCUMENT_NOT_OPEN')
    expect(JSON.stringify(result)).toMatch(/list_tabs/)
  })

  it('refuses an empty, non-string or oversized target', () => {
    for (const document of ['  ', 42, 'x'.repeat(5000)]) {
      const result = splitMcpTarget('get_outline', { document }, 'mcp-6')
      expect('error' in result && result.error.success === false && result.error.code).toBe('INVALID_ARGS')
    }
  })

  it('treats a null target as none', () => {
    expect(splitMcpTarget('get_outline', { document: null }, 'mcp-7')).toEqual({ args: {} })
  })

  it('drops a target on a tool that takes none', () => {
    expect(splitMcpTarget('list_tabs', { document: 'doc-a' }, 'mcp-8')).toEqual({ args: {} })
  })
})

describe('the MCP tool list', () => {
  it('carries `document` on the document tools only', () => {
    const withTarget = getToolsForMCP()
      .filter((t) => (t.inputSchema.properties as Record<string, unknown> | undefined)?.document)
      .map((t) => t.name)
      .sort()
    expect(withTarget).toEqual([
      'add_comment', 'get_outline', 'get_review_status', 'list_comments', 'list_review_events', 'list_suggestions',
      'read_document', 'reopen_comment', 'reply_to_comment', 'reply_to_suggestion', 'resolve_comment', 'revise_suggestion',
      'suggest_delete', 'suggest_edit', 'suggest_insert',
    ])
  })

  it('keeps accept and reject off the MCP surface: the writer decides (#607)', () => {
    const names = getToolsForMCP().map((t) => t.name)
    expect(names).not.toContain('accept_diff')
    expect(names).not.toContain('reject_diff')
    expect(names).toEqual(expect.arrayContaining(['list_suggestions', 'reply_to_suggestion', 'revise_suggestion', 'get_review_status', 'list_review_events', 'reply_to_comment', 'reopen_comment']))
  })
})
