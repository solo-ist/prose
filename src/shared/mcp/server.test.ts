// @vitest-environment node
/**
 * The MCP tool metadata and result shape (#1235): every MCP tool has a title,
 * annotations and an output schema that accepts what its executor returns;
 * the MCP descriptions and the server instructions name only tools an MCP
 * client can call.
 */
import { describe, expect, it } from 'vitest'
import { fromJsonSchema } from '@modelcontextprotocol/server'
import { allTools, getToolsForMCP, isMcpDocumentTool, mcpToolNames } from '../tools/registry'
import { MCP_TOOL_METADATA } from '../tools/mcpMetadata'
import { PROSE_MCP_INSTRUCTIONS } from './instructions'
import { toCallToolResult } from './server'

/** One success payload per tool, shaped like its executor's `toolSuccess(...)`. */
const SUCCESS_PAYLOADS: Record<string, unknown[]> = {
  read_document: [
    {
      nodes: [
        { id: 'frontmatter', type: 'frontmatter', content: 'title: A' },
        { id: 'p1', type: 'paragraph', content: 'Hello' },
        { id: '', type: 'table', content: '| a |\n| --- |', children: [{ id: 'c1', type: 'paragraph', content: 'a' }] }
      ],
      markdown: 'Hello\n'
    }
  ],
  get_outline: [{ outline: [{ level: 1, text: 'Title', line: 1 }] }, { outline: [], summary: 'A short note.' }],
  list_comments: [
    {
      comments: [
        { id: 'c1', markedText: 'Hello', comment: 'Tighten', createdAt: 1, from: 1, to: 6, replies: [], resolved: false },
        { id: 'c2', markedText: 'gone', comment: 'Old', createdAt: 2, from: 0, to: 0, replies: [{ id: 'r', author: 'user', text: 'ok', createdAt: 3 }], resolved: false, anchorLost: true }
      ]
    }
  ],
  add_comment: [{ id: 'c3' }],
  resolve_comment: [{ resolved: true }],
  suggest_edit: [{ suggested: true, suggestionId: 's1' }],
  open_file: [{ opened: true, path: '/Users/u/a.md' }],
  create_and_open_file: [{ path: '/Users/u/Documents/Untitled 2.md', opened: true }],
  list_tabs: [
    { tabs: [{ tabId: 't1', title: 'Draft', path: null, isActive: true, isDirty: true, isPreview: false, documentId: 'd1' }] }
  ],
  select_tab: [{ selected: true, tabId: 't1', title: 'Draft', path: null }, { selected: true, tabId: 't2', title: 'A', path: '/a.md' }]
}

async function accepts(schema: Record<string, unknown>, value: unknown): Promise<boolean> {
  const result = await fromJsonSchema(schema as never)['~standard'].validate(value)
  return !('issues' in result && result.issues)
}

describe('MCP tool metadata', () => {
  it('covers exactly the MCP tools', () => {
    expect(Object.keys(MCP_TOOL_METADATA).sort()).toEqual([...mcpToolNames].sort())
    expect(getToolsForMCP().map((t) => t.name).sort()).toEqual([...mcpToolNames].sort())
  })

  it.each([...mcpToolNames])('%s: its output schema accepts what the executor returns', async (name) => {
    const tool = getToolsForMCP().find((t) => t.name === name)!
    expect(tool.outputSchema.type).toBe('object')
    for (const payload of SUCCESS_PAYLOADS[name]) {
      expect(await accepts(tool.outputSchema, payload)).toBe(true)
    }
  })

  it('document tools keep their `document` target (#1237) beside the output schema', () => {
    for (const tool of getToolsForMCP()) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>
      expect({ tool: tool.name, document: 'document' in properties }).toEqual({ tool: tool.name, document: isMcpDocumentTool(tool.name) })
    }
  })

  it('output schemas really validate', async () => {
    const suggest = getToolsForMCP().find((t) => t.name === 'suggest_edit')!
    expect(await accepts(suggest.outputSchema, { suggested: true })).toBe(false)
  })

  it('MCP descriptions and the instructions name only tools an MCP client can call', () => {
    const offSurface = allTools.map((t) => t.name).filter((n) => !(mcpToolNames as readonly string[]).includes(n))
    const named = (text: string): string[] => offSurface.filter((n) => new RegExp(`\\b${n}\\b`).test(text))
    for (const tool of getToolsForMCP()) {
      expect({ tool: tool.name, names: named(tool.description) }).toEqual({ tool: tool.name, names: [] })
    }
    expect(named(PROSE_MCP_INSTRUCTIONS)).toEqual([])
    expect(PROSE_MCP_INSTRUCTIONS).not.toMatch(/Claude/)
  })
})

describe('toCallToolResult', () => {
  it('carries an object payload as text and structuredContent', () => {
    const result = toCallToolResult({ success: true, data: { id: 'c1' } })
    expect(result.structuredContent).toEqual({ id: 'c1' })
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ id: 'c1' }, null, 2) }])
    expect(result.isError).toBeUndefined()
  })

  it('keeps a string payload text-only', () => {
    expect(toCallToolResult({ success: true, data: 'done' })).toEqual({ content: [{ type: 'text', text: 'done' }] })
  })

  it('reports a failure with its code', () => {
    expect(toCallToolResult({ success: false, error: 'tab not found', code: 'TAB_NOT_FOUND' })).toEqual({
      content: [{ type: 'text', text: 'Error: tab not found (TAB_NOT_FOUND)' }],
      isError: true
    })
  })
})
