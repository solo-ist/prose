/**
 * Markdown creation + round-trip canary (#672) — Case B of the AI markdown
 * hardening plan: create a document through the real create_and_open_file
 * tool with every supported block type, verify all of them land as real
 * ProseMirror nodes (not literal syntax), and verify getMarkdown()
 * serialization is idempotent.
 *
 * Isolated PROSE_USER_DATA_DIR profile. The profile's settings.json seeds
 * defaultSaveDirectory to a temp dir — create_and_open_file writes there
 * instead of the developer's real ~/Documents — and enables
 * featureFlags.aiPipelineDebug so the spec also exercises the pipeline log.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  executeProseTool,
  exportPipelineLog,
} from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string
let qaDocsDir: string

const FULL_MARKDOWN = [
  '# Heading One',
  '',
  'Intro paragraph with **bold** and *italic* text.',
  '',
  '## Heading Two',
  '',
  '> A quoted line of text',
  '',
  '- Bullet item one',
  '- Bullet item two',
  '',
  '1. Ordered item one',
  '2. Ordered item two',
  '',
  '| Col1 | Col2 |',
  '| --- | --- |',
  '| A | B |',
  '',
  '```js',
  'const x = 1',
  '```',
].join('\n')

test.beforeAll(async () => {
  test.setTimeout(60_000)

  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-qa-profile-'))
  qaDocsDir = mkdtempSync(join(tmpdir(), 'prose-qa-docs-'))
  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', icon: 'default' },
        defaultSaveDirectory: qaDocsDir,
        featureFlags: { aiPipelineDebug: true },
      },
      null,
      2,
    ),
  )

  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir } })
  app = launched.app
  page = launched.page

  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
  rmSync(qaDocsDir, { recursive: true, force: true })
})

test.describe('Electron — Markdown creation round-trip', () => {
  test('create_and_open_file renders every block type as real nodes', async () => {
    const result = await executeProseTool(page, 'create_and_open_file', {
      filename: 'roundtrip.md',
      content: FULL_MARKDOWN,
    })
    expect(result.success).toBe(true)

    await waitForEditor(page)

    // Collect all node types and heading levels present in the document
    const summary = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      const types = new Set<string>()
      const headingLevels: number[] = []
      const boldRuns: string[] = []
      editor.state.doc.descendants(
        (node: {
          type: { name: string }
          attrs: Record<string, unknown>
          isText: boolean
          text?: string
          marks: Array<{ type: { name: string } }>
        }) => {
          types.add(node.type.name)
          if (node.type.name === 'heading') headingLevels.push(node.attrs.level as number)
          if (node.isText && node.marks.some((m) => m.type.name === 'bold')) {
            boldRuns.push(node.text ?? '')
          }
        },
      )
      return {
        types: Array.from(types),
        headingLevels,
        boldRuns,
        text: editor.state.doc.textContent as string,
      }
    })

    // Every block type must be a real node
    for (const expected of ['heading', 'blockquote', 'bulletList', 'orderedList', 'table', 'codeBlock']) {
      expect(summary.types, `expected node type "${expected}"`).toContain(expected)
    }
    expect(summary.headingLevels).toEqual([1, 2])
    expect(summary.boldRuns).toContain('bold')

    // No literal markdown syntax may survive as text
    expect(summary.text).not.toContain('# ')
    expect(summary.text).not.toContain('> ')
    expect(summary.text).not.toContain('**')
    expect(summary.text).not.toContain('| Col1')
  })

  test('getMarkdown serialization is idempotent', async () => {
    const first = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      return editor.storage.markdown.getMarkdown() as string
    })

    // Serialized output must contain the canonical syntax
    expect(first).toContain('# Heading One')
    expect(first).toContain('> A quoted line of text')
    expect(first).toContain('- Bullet item one')
    expect(first).toContain('**bold**')
    expect(first).toContain('| Col1 | Col2 |')

    // Round-trip: re-parse the serialized markdown, serialize again — stable
    const second = await page.evaluate((md) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      editor.commands.setContent(md)
      return editor.storage.markdown.getMarkdown() as string
    }, first)

    expect(second).toBe(first)
  })

  test('pipeline debug log captured structured events', async () => {
    const raw = await exportPipelineLog(page)
    const entries = JSON.parse(raw) as Array<{ ts: number; event: string; data: unknown }>
    expect(Array.isArray(entries)).toBe(true)
    expect(entries.length).toBeGreaterThan(0)
    // Opening the created file loads its (empty) annotation set → annotation:load
    expect(entries.map((e) => e.event)).toContain('annotation:load')
  })
})
