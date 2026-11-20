/**
 * The Claude Desktop extension (`.mcpb`) for the stdio bridge (#1257).
 *
 * Claude Desktop runs an extension's `node` server on its own built-in Node
 * when no system Node satisfies `compatibility.runtimes.node`, so a Mac with
 * no Node (or an old one) can use Prose. Main builds the archive per profile
 * at install time: the bridge finds its profile from where it runs (#1235),
 * and an extension runs from Claude Desktop's extensions folder, so any
 * profile other than the installed app's is passed in the manifest's `env`.
 *
 * Pure: no electron import, so the manifest is unit-tested as data.
 */

import { basename } from 'path'
import { createZip } from './zip'
import { getToolsForMCP } from '../../shared/tools/registry'

export interface McpbProfile {
  /** The profile folder (`app.getPath('userData')`). */
  dir: string
  /** The installed app's own profile: the bridge's default, so no `env` is needed. */
  isInstalledApp: boolean
}

/** Where the server sits inside the archive. */
export const MCPB_SERVER_ENTRY = 'server/index.cjs'

/** The bridge targets Node 20 (the v2 MCP SDK's floor). */
export const MCPB_NODE_RUNTIME = '>=20.0.0'

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'profile'
}

/** A tool's description for the extension listing: its first sentence, ending in a period. */
function firstSentence(text: string): string {
  const match = /^.*?[.!?](\s|$)/.exec(text)
  const sentence = (match ? match[0] : text).trim()
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}

export function mcpbManifest(version: string, profile: McpbProfile, platform: NodeJS.Platform): Record<string, unknown> {
  const profileName = basename(profile.dir)
  return {
    manifest_version: '0.3',
    name: profile.isInstalledApp ? 'prose' : `prose-${slug(profileName)}`,
    display_name: profile.isInstalledApp ? 'Prose' : `Prose (${profileName})`,
    version,
    description: 'Read, comment on and suggest edits to the documents open in Prose. The writer accepts or rejects every change in Prose.',
    author: { name: 'Solo', url: 'https://solo.ist' },
    homepage: 'https://solo.ist/prose',
    license: 'MIT',
    server: {
      type: 'node',
      entry_point: MCPB_SERVER_ENTRY,
      mcp_config: {
        command: 'node',
        args: [`\${__dirname}/${MCPB_SERVER_ENTRY}`],
        env: profile.isInstalledApp ? {} : { PROSE_USER_DATA_DIR: profile.dir }
      }
    },
    tools: getToolsForMCP().map((tool) => ({ name: tool.name, description: firstSentence(tool.description) })),
    compatibility: { platforms: [platform], runtimes: { node: MCPB_NODE_RUNTIME } }
  }
}

/** The `.mcpb` archive: the manifest at the root, the bundled bridge beside it. */
export function buildMcpb(server: Buffer, manifest: Record<string, unknown>): Buffer {
  return createZip([
    { name: 'manifest.json', data: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: MCPB_SERVER_ENTRY, data: server, mode: 0o755 }
  ])
}
