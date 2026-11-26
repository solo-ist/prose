// @vitest-environment node
/**
 * Schema-emission snapshot for the tool registry (#1216).
 *
 * Purpose: pin the JSON Schema that the registry emits for every tool so that
 * a future zod upgrade or generator change that silently alters what the model
 * sees fails this test before reaching CI or production.
 *
 * The test also asserts the structural invariants that the zod 4 migration
 * must preserve:
 *   - Optional-with-default fields must NOT appear in `required` (the caller
 *     may omit them; zod applies the default at parse time).
 *   - Every object schema must carry `additionalProperties: false`.
 *
 * When an intentional schema change is made, update the snapshot with:
 *   npx vitest run src/shared/tools/registry.test.ts --update-snapshots
 */
import { describe, expect, it } from 'vitest'
import { allTools, getToolsForClaudeAPI, getToolsForMCP } from './registry'
import { zodToJsonSchema } from './utils'

describe('zodToJsonSchema invariants', () => {
  it('every object schema has additionalProperties: false', () => {
    for (const tool of allTools) {
      const schema = zodToJsonSchema(tool.schema)
      if (schema.type === 'object') {
        expect({ tool: tool.name, additionalProperties: schema.additionalProperties }).toEqual({
          tool: tool.name,
          additionalProperties: false
        })
      }
    }
  })

  it('optional-with-default fields are NOT in required', () => {
    // These are fields that have .default() — the caller can omit them.
    const optionalWithDefaults: Record<string, string[]> = {
      search_document: ['regex', 'caseSensitive', 'maxResults'],
      insert: ['position'],
      move_cursor: ['position'],
      new_file: ['content'],
      list_files: ['maxDepth', 'maxFiles'],
      create_and_open_file: ['content'],
    }
    for (const tool of allTools) {
      const defaults = optionalWithDefaults[tool.name]
      if (!defaults) continue
      const schema = zodToJsonSchema(tool.schema)
      const required = (schema.required as string[] | undefined) ?? []
      for (const field of defaults) {
        expect({ tool: tool.name, field, inRequired: required.includes(field) }).toEqual({
          tool: tool.name,
          field,
          inRequired: false
        })
      }
    }
  })
})

describe('schema snapshots', () => {
  it('LLM tool definitions snapshot (getToolsForClaudeAPI)', () => {
    const defs = getToolsForClaudeAPI('create')
    // Snapshot the input schemas only (descriptions are tested elsewhere and
    // change more frequently; we only care about the structural contract).
    const schemas = Object.fromEntries(defs.map((d) => [d.name, d.input_schema]))
    expect(schemas).toMatchSnapshot()
  })

  it('MCP tool input schemas snapshot', () => {
    const defs = getToolsForMCP()
    const schemas = Object.fromEntries(defs.map((d) => [d.name, d.inputSchema]))
    expect(schemas).toMatchSnapshot()
  })
})
