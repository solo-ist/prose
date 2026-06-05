/**
 * Scene 2 ("AI Alongside You") — the chat mode-switch exchange.
 * Run: npx playwright test electron.screenshot-chat --workers=1
 *
 * Mocked deterministically: injects a user prompt + an assistant message that
 * carries the REAL request_mode_switch tool-result tag, so the card rendered
 * is the actual RequestModeSwitchResult component (visually identical to a live
 * exchange). Uses the always-on window.__prose_chat test seam (main.tsx),
 * same tier as __prose_tools. No API key, no live call.
 */
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitForAppReady, dismissOnboarding, dismissOverlay, waitForEditor, executeProseTool } from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')
const FIXTURE = join(REPO, 'e2e/fixtures/a-chorus-of-human-voices.md')
const SHOTS = '/tmp/prose-shots'

const USER_PROMPT = 'Can you rewrite my opening paragraph to be punchier and more direct?'
const MODE_SWITCH = JSON.stringify({
  target: 'editor',
  reason: 'Editor mode proposes the rewrite as a tracked suggestion you accept or reject.',
  prompt_to_retry: 'Rewrite my opening paragraph to be punchier and more direct.',
})
const ASSISTANT = `I stay read-only in Chat mode — I won't rewrite your prose for you. But I can propose it as a tracked suggestion in **Editor mode**, where you keep the final say on every word:\n\n<tool-result name="request_mode_switch" success="true">${MODE_SWITCH}</tool-result>`

let app: ElectronApplication
let page: Page

// Generator — excluded from the normal e2e suite; opt in with SHOOT=1.
test.skip(process.env.SHOOT !== '1', 'marketing screenshot generator (run with SHOOT=1)')

test('02 ai alongside you — mode-switch (dark)', async () => {
  test.setTimeout(90_000)
  const profile = mkdtempSync(join(tmpdir(), 'prose-shot-chat-'))
  const docs = mkdtempSync(join(tmpdir(), 'prose-shot-chat-docs-'))
  const heroPath = join(docs, 'A Chorus of Human Voices.md')
  writeFileSync(heroPath, readFileSync(FIXTURE, 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, ''))
  writeFileSync(
    join(profile, 'settings.json'),
    JSON.stringify({
      appearance: { color: 'prose', mode: 'dark', icon: 'pilcrow', migrationToastShown: true },
      // Fake key so the chat renders configured (never sent — the exchange is injected).
      aiConsent: { consented: true, consentedAt: '2025-01-01T00:00:00.000Z' },
      llm: { provider: 'anthropic', apiKey: 'sk-ant-demo-screenshot-key', model: 'claude-sonnet-4-6' },
      toolMode: 'chat',
      defaultSaveDirectory: docs,
    }),
  )

  app = await electron.launch({
    args: [join(REPO, 'out/main/index.js')],
    env: { ...(process.env as Record<string, string>), PROSE_USER_DATA_DIR: profile },
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setContentSize(1280, 800)
    w.center()
  })
  await page.evaluate(() => document.documentElement.classList.add('dark'))

  const opened = await executeProseTool(page, 'open_file', { path: heroPath })
  expect(opened.success).toBe(true)
  await waitForEditor(page)
  const hide = page.locator('[aria-label="Hide files"]')
  if (await hide.isVisible({ timeout: 1_000 }).catch(() => false)) await hide.click()
  const showChat = page.locator('[aria-label="Show chat"]')
  if (await showChat.isVisible({ timeout: 1_000 }).catch(() => false)) await showChat.click()
  await page.waitForTimeout(400)

  // Inject the scripted exchange (real tool-result tag → real card).
  await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ user, assistant }: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chat = (window as any).__prose_chat
      chat.addConversation('demo')
      chat.addMessage({ id: 'u1', role: 'user', content: user, timestamp: new Date() })
      chat.addMessage({ id: 'a1', role: 'assistant', content: assistant, timestamp: new Date() })
    },
    { user: USER_PROMPT, assistant: ASSISTANT },
  )

  // The card's primary button is "Switch to <Mode> & Run".
  await expect(page.getByRole('button', { name: /Switch to .* & Run/i })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(SHOTS, '02-ai-chat.png') })
  await app.close()
  rmSync(profile, { recursive: true, force: true })
  rmSync(docs, { recursive: true, force: true })
})
