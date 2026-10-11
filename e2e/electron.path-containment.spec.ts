/**
 * Path-source containment (#918, audit H-03).
 *
 * `normalizePath()` is a normalizer, not containment. These tests pin the
 * handlers whose paths come from CONTENT or TOOL ARGUMENTS and must therefore
 * stay inside an explicit root:
 *
 * - file:readBase64 (HTML export image inlining) is contained to the document
 *   directory + image extensions, on the REAL path (symlinks can't escape).
 * - The LLM/MCP file tools (read_file, open_file, save_file, list_files) are
 *   contained to text files under the home folder, outside hidden folders.
 * - The local-file: protocol serves only images under home, on the real path.
 *
 * Uses an isolated PROSE_USER_DATA_DIR. The tool policy's root is the real
 * home directory, so the fixture tree lives in a throwaway folder directly
 * under $HOME and is removed afterwards; the "outside" tree lives in tmpdir.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  executeProseTool,
} from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string
let homeDir: string // fixture root directly under $HOME
let outsideDir: string // fixture root outside $HOME (tmpdir)

// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const SECRET = 'SECRET-OUTSIDE-BYTES'

// Refusal wording differs by handler: file:read/save return the sanitized
// FileOperationFailure message, file:listDirectory surfaces the helper's own.
const REFUSED = /outside the allowed area|resolves outside|not accessible under/
const NOT_TEXT = /File type is not allowed|limited to text files/

type BridgeWindow = Window & {
  api: {
    readFileBase64: (path: string, allowedRoot: string) => Promise<string>
  }
}

// First launch of a fresh build can exceed Playwright's 30s default.
test.setTimeout(180_000)

test.beforeAll(async () => {
  test.setTimeout(180_000)
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-918-userdata-'))
  outsideDir = mkdtempSync(join(tmpdir(), 'prose-918-outside-'))
  homeDir = join(homedir(), `prose-e2e-918-${process.pid}-${Date.now()}`)
  mkdirSync(join(homeDir, 'notes'), { recursive: true })
  mkdirSync(join(homeDir, '.hidden'), { recursive: true })

  writeFileSync(join(homeDir, 'notes', 'a.md'), '# A\n\nhello from a\n')
  writeFileSync(join(homeDir, 'inline.png'), TINY_PNG)
  writeFileSync(join(homeDir, 'secret.key'), 'not-an-image')
  writeFileSync(join(homeDir, '.hidden', 'h.md'), 'hidden markdown\n')
  writeFileSync(join(outsideDir, 'outside.png'), Buffer.from(SECRET))
  writeFileSync(join(outsideDir, 'outside.md'), 'outside markdown\n')
  // Lexically inside home, really outside it.
  symlinkSync(join(outsideDir, 'outside.png'), join(homeDir, 'leak.png'))
  symlinkSync(join(outsideDir, 'outside.md'), join(homeDir, 'leak.md'))
  // Visible name that resolves into a hidden folder.
  symlinkSync(join(homeDir, '.hidden', 'h.md'), join(homeDir, 'sneaky.md'))

  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify(
      {
        appearance: { mode: 'dark', color: 'mono', icon: 'pilcrow', migrationToastShown: true },
        fileAssociation: { hasBeenPrompted: true },
        aiConsent: { consented: false, consentedAt: new Date().toISOString(), version: 1 },
        recovery: { mode: 'silent' },
        autosave: { mode: 'off', intervalSeconds: 30 },
        defaultSaveDirectory: homeDir,
      },
      null,
      2,
    ),
  )

  console.log('[918] launching')
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir } })
  app = launched.app
  page = launched.page
  console.log('[918] first window')
  await waitForAppReady(page)
  console.log('[918] app ready')
  await dismissOnboarding(page)
  await dismissOverlay(page)
  console.log('[918] setup done')
})

test.afterAll(async () => {
  await app?.close()
  for (const dir of [homeDir, outsideDir, userDataDir]) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

// ---------------------------------------------------------------------------
// file:readBase64 — document-content image paths (H-03)
// ---------------------------------------------------------------------------

test('readBase64 refuses escapes, symlinks, non-images and a missing root', async () => {
  const attempt = (path: string, root: string): Promise<string> =>
    page.evaluate(
      async ({ p, r }) => {
        try {
          return await (window as unknown as BridgeWindow).api.readFileBase64(p, r)
        } catch (err) {
          return `ERR: ${err instanceof Error ? err.message : String(err)}`
        }
      },
      { p: path, r: root },
    )

  // In-root image reads round-trip the bytes (relative and absolute).
  expect(await attempt('inline.png', homeDir)).toBe(TINY_PNG.toString('base64'))
  expect(await attempt(join(homeDir, 'inline.png'), homeDir)).toBe(TINY_PNG.toString('base64'))

  expect(await attempt('../outside.png', homeDir)).toContain('outside the document directory')
  expect(await attempt(join(outsideDir, 'outside.png'), homeDir)).toContain('outside the document directory')
  expect(await attempt('secret.key', homeDir)).toContain('limited to image files')
  expect(await attempt('notes/a.md', homeDir)).toContain('limited to image files')
  expect(await attempt('inline.png', '')).toContain('requires a containment root')

  // Symlink escape: lexically in-root, realpath lands outside — never the bytes.
  const leak = await attempt('leak.png', homeDir)
  expect(leak).toContain('outside the document directory')
  expect(leak).not.toContain(Buffer.from(SECRET).toString('base64'))
})

// ---------------------------------------------------------------------------
// LLM / MCP file tools — home + text extensions + no hidden folders
// ---------------------------------------------------------------------------

test('read_file / open_file are contained to text files under home, outside hidden folders', async () => {
  const ok = await executeProseTool(page, 'read_file', { path: join(homeDir, 'notes', 'a.md') })
  expect(ok.success).toBe(true)
  expect((ok.data as { content: string }).content).toContain('hello from a')

  // ~ expansion still works for the chat's "open ~/notes/x.md".
  const tilde = await executeProseTool(page, 'read_file', {
    path: join('~', homeDir.slice(homedir().length + 1), 'notes', 'a.md'),
  })
  expect(tilde.success).toBe(true)

  const hidden = await executeProseTool(page, 'read_file', { path: join(homeDir, '.hidden', 'h.md') })
  expect(hidden.success).toBe(false)
  expect(hidden.error).toMatch(REFUSED)

  // A probe into a hidden folder that does not exist is refused the same way
  // (no existence oracle).
  const sshProbe = await executeProseTool(page, 'read_file', {
    path: join(homeDir, '.hidden', 'does-not-exist.md'),
  })
  expect(sshProbe.success).toBe(false)
  expect(sshProbe.error).toMatch(REFUSED)

  const outside = await executeProseTool(page, 'read_file', { path: join(outsideDir, 'outside.md') })
  expect(outside.success).toBe(false)
  expect(outside.error).toMatch(REFUSED)

  const symlinkOut = await executeProseTool(page, 'read_file', { path: join(homeDir, 'leak.md') })
  expect(symlinkOut.success).toBe(false)
  expect(symlinkOut.error).toMatch(REFUSED)

  const symlinkHidden = await executeProseTool(page, 'read_file', { path: join(homeDir, 'sneaky.md') })
  expect(symlinkHidden.success).toBe(false)
  expect(symlinkHidden.error).toMatch(REFUSED)

  const binary = await executeProseTool(page, 'read_file', { path: join(homeDir, 'secret.key') })
  expect(binary.success).toBe(false)
  expect(binary.error).toMatch(NOT_TEXT)

  const openHidden = await executeProseTool(page, 'open_file', { path: join(homeDir, '.hidden', 'h.md') })
  expect(openHidden.success).toBe(false)
  expect(openHidden.error).toMatch(REFUSED)
})

test('save_file is contained; list_files is contained', async () => {
  const outsideSave = await executeProseTool(page, 'save_file', { path: join(outsideDir, 'written.md') })
  expect(outsideSave.success).toBe(false)
  expect(outsideSave.error).toMatch(REFUSED)
  expect(existsSync(join(outsideDir, 'written.md'))).toBe(false)

  const hiddenSave = await executeProseTool(page, 'save_file', { path: join(homeDir, '.hidden', 'written.md') })
  expect(hiddenSave.success).toBe(false)
  expect(existsSync(join(homeDir, '.hidden', 'written.md'))).toBe(false)

  const keySave = await executeProseTool(page, 'save_file', { path: join(homeDir, 'notes', 'written.key') })
  expect(keySave.success).toBe(false)
  expect(keySave.error).toMatch(NOT_TEXT)

  // A new text file under home is allowed (parent must exist).
  const okSave = await executeProseTool(page, 'save_file', { path: join(homeDir, 'notes', 'written.md') })
  expect(okSave.success).toBe(true)
  expect(existsSync(join(homeDir, 'notes', 'written.md'))).toBe(true)
  expect(typeof readFileSync(join(homeDir, 'notes', 'written.md'), 'utf-8')).toBe('string')

  const list = await executeProseTool(page, 'list_files', { path: homeDir })
  expect(list.success).toBe(true)
  const names = JSON.stringify(list.data)
  expect(names).toContain('notes')

  const listHidden = await executeProseTool(page, 'list_files', { path: join(homeDir, '.hidden') })
  expect(listHidden.success).toBe(false)
  expect(listHidden.error).toMatch(REFUSED)

  const listOutside = await executeProseTool(page, 'list_files', { path: outsideDir })
  expect(listOutside.success).toBe(false)
  expect(listOutside.error).toMatch(REFUSED)
})

// ---------------------------------------------------------------------------
// local-file: protocol — real-path containment to home + image extensions
// ---------------------------------------------------------------------------

test('local-file: serves in-home images and refuses symlink escapes and non-images', async () => {
  const status = (filePath: string): Promise<number> =>
    app.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url)
      return response.status
    }, `local-file://${encodeURI(filePath)}`)

  expect(await status(join(homeDir, 'inline.png'))).toBe(200)
  expect(await status(join(homeDir, 'leak.png'))).toBe(403)
  expect(await status(join(homeDir, 'secret.key'))).toBe(403)
  expect(await status(join(outsideDir, 'outside.png'))).toBe(403)
  expect(await status(join(homeDir, 'missing.png'))).toBe(404)
})

// ---------------------------------------------------------------------------
// MCP — the 10-tool allowlist must hold on tools/call, not just tools/list
// ---------------------------------------------------------------------------

test('MCP tools/call refuses tools outside the allowlist', async () => {
  const token = readFileSync(join(userDataDir, 'mcp-auth-token'), 'utf-8').trim()

  // Stateless Streamable HTTP: one JSON-RPC request per POST; the reply comes
  // back as an SSE `data:` line (or plain JSON).
  const rpc = async (method: string, params: unknown): Promise<Record<string, unknown> | null> => {
    let response: Response
    try {
      response = await fetch('http://127.0.0.1:9877/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
    } catch {
      return null // nothing listening
    }
    if (response.status === 401) return null // another Prose instance owns the port
    const text = await response.text()
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'))
    return JSON.parse(dataLine ? dataLine.slice(5).trim() : text) as Record<string, unknown>
  }

  const listed = await rpc('tools/list', {})
  test.skip(listed === null, 'MCP port 9877 is held by another Prose instance (or unavailable)')

  const tools = ((listed!.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name)
  expect(tools).toContain('open_file')
  expect(tools).not.toContain('read_file')
  expect(tools).not.toContain('save_file')
  expect(tools).not.toContain('list_files')

  const call = await rpc('tools/call', {
    name: 'read_file',
    arguments: { path: join(homeDir, 'notes', 'a.md') },
  })
  const result = call!.result as { isError?: boolean; content: unknown }
  expect(result.isError).toBe(true)
  const body = JSON.stringify(result.content)
  expect(body).toContain('not available over MCP')
  expect(body).not.toContain('hello from a')
})
