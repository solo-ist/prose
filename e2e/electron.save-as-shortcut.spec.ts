/**
 * ⌘⇧S reaches Save As (#1169).
 *
 * StarterKit's Strike bound Mod-Shift-s to toggleStrike, and a keydown the
 * page handles never reaches the File menu's accelerator, so ⌘⇧S with the
 * editor focused silently toggled a stored strike mark and Save As never
 * opened. Strike now ships without that keymap (⌘⇧X is strikethrough), so the
 * editor leaves the chord alone.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay, waitForEditor } from './helpers'

let app: ElectronApplication
let page: Page
let qaUserDataDir: string

test.beforeAll(async () => {
  test.setTimeout(90_000)
  qaUserDataDir = mkdtempSync(join(tmpdir(), 'prose-1169-'))
  writeFileSync(
    join(qaUserDataDir, 'settings.json'),
    JSON.stringify({ aiConsent: { consented: false, version: 1 }, lastSeenVersion: '0.0.0' }, null, 2)
  )
  const result = await launchApp({ env: { PROSE_USER_DATA_DIR: qaUserDataDir, PROSE_DEBUG_PORT: '9229' } })
  app = result.app
  page = result.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(qaUserDataDir, { recursive: true, force: true })
})

test.describe('Electron — ⌘⇧S is not strikethrough (#1169)', () => {
  test('the editor does not handle Mod-Shift-s, and ⌘⇧X still strikes', async () => {
    await page.locator('.prose-editor .ProseMirror').click()
    await page.keyboard.type('Plain words ')
    await page.keyboard.press('ControlOrMeta+Shift+s')
    // Before #1169 this toggled a stored strike mark on the collapsed caret.
    const struckAfterChord = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__prose_editor.isActive('strike') as boolean
    })
    expect(struckAfterChord).toBe(false)
    await page.keyboard.type('still plain')
    await expect(page.locator('.ProseMirror s, .ProseMirror del')).toHaveCount(0)

    // The shortcut Prose does bind is unchanged.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__prose_editor.commands.selectAll()
    })
    await page.keyboard.press('ControlOrMeta+Shift+x')
    await expect(page.locator('.ProseMirror s, .ProseMirror del').first()).toBeVisible()
  })

  test('the extension list declares the choice', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, '../src/renderer/components/editor/extensions.ts'), 'utf8')
    expect(source).toMatch(/strike:\s*false/)
    expect(source).toMatch(/Strike\.extend\(\{\s*addKeyboardShortcuts\(\)\s*\{\s*return \{\}/)
  })
})
