// @vitest-environment node
/** The Claude Desktop extension's manifest per profile, and the archive (#1257). */
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMcpb, mcpbManifest, MCPB_SERVER_ENTRY } from './mcpb'
import { mcpToolNames } from '../../shared/tools/registry'

const HOME = '/Users/u/Library/Application Support'

/** The manifest minus its tool list, which follows the registry (checked separately). */
function shape(manifest: Record<string, unknown>): Record<string, unknown> {
  const { tools: _tools, ...rest } = manifest
  return rest
}

describe('mcpbManifest', () => {
  it('the installed app: name "prose", no env (the bridge defaults to this profile)', () => {
    expect(shape(mcpbManifest('1.9.1', { dir: `${HOME}/prose`, isInstalledApp: true }, 'darwin'))).toMatchInlineSnapshot(`
      {
        "author": {
          "name": "Solo",
          "url": "https://solo.ist",
        },
        "compatibility": {
          "platforms": [
            "darwin",
          ],
          "runtimes": {
            "node": ">=20.0.0",
          },
        },
        "description": "Read, comment on and suggest edits to the documents open in Prose. The writer accepts or rejects every change in Prose.",
        "display_name": "Prose",
        "homepage": "https://solo.ist/prose",
        "license": "MIT",
        "manifest_version": "0.3",
        "name": "prose",
        "server": {
          "entry_point": "server/index.cjs",
          "mcp_config": {
            "args": [
              "\${__dirname}/server/index.cjs",
            ],
            "command": "node",
            "env": {},
          },
          "type": "node",
        },
        "version": "1.9.1",
      }
    `)
  })

  it('the dev profile: its own name, and the profile passed in env', () => {
    const manifest = mcpbManifest('1.9.1', { dir: `${HOME}/Prose Dev`, isInstalledApp: false }, 'darwin')
    expect({ name: manifest.name, display_name: manifest.display_name, server: manifest.server }).toMatchInlineSnapshot(`
      {
        "display_name": "Prose (Prose Dev)",
        "name": "prose-prose-dev",
        "server": {
          "entry_point": "server/index.cjs",
          "mcp_config": {
            "args": [
              "\${__dirname}/server/index.cjs",
            ],
            "command": "node",
            "env": {
              "PROSE_USER_DATA_DIR": "/Users/u/Library/Application Support/Prose Dev",
            },
          },
          "type": "node",
        },
      }
    `)
  })

  it('a test profile anywhere: a name Claude Desktop accepts, the folder in env', () => {
    const manifest = mcpbManifest('1.9.1', { dir: '/tmp/prose-e2e-ÄB c', isInstalledApp: false }, 'linux')
    expect(manifest.name).toBe('prose-prose-e2e-b-c')
    expect((manifest.server as { mcp_config: { env: Record<string, string> } }).mcp_config.env).toEqual({ PROSE_USER_DATA_DIR: '/tmp/prose-e2e-ÄB c' })
    expect(manifest.compatibility).toEqual({ platforms: ['linux'], runtimes: { node: '>=20.0.0' } })
  })

  it('lists every MCP tool with a one-sentence description', () => {
    const tools = mcpbManifest('1.9.1', { dir: `${HOME}/prose`, isInstalledApp: true }, 'darwin').tools as Array<{ name: string; description: string }>
    expect(tools.map((t) => t.name).sort()).toEqual([...mcpToolNames].sort())
    for (const tool of tools) expect(tool.description).toMatch(/^[^\n]+[.!?]$/)
  })
})

describe('buildMcpb', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('holds the manifest and the server, and nothing else', () => {
    const manifest = mcpbManifest('1.9.1', { dir: `${HOME}/Prose Dev`, isInstalledApp: false }, 'darwin')
    const server = Buffer.from('#!/usr/bin/env node\nconsole.log("bridge")\n')
    dir = mkdtempSync(join(tmpdir(), 'prose-mcpb-'))
    const file = join(dir, 'Prose.mcpb')
    writeFileSync(file, buildMcpb(server, manifest))
    const names = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n')
    expect(names).toEqual(['manifest.json', MCPB_SERVER_ENTRY])
    expect(JSON.parse(execFileSync('unzip', ['-p', file, 'manifest.json'], { encoding: 'utf8' }))).toEqual(manifest)
    expect(Buffer.compare(execFileSync('unzip', ['-p', file, MCPB_SERVER_ENTRY]), server)).toBe(0)
  })
})
