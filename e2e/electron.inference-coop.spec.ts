/**
 * Inference Coop as a Prose Agents provider (#956), over the Chat Completions
 * adapter.
 *
 * The gateway is never called: `fetch` in the main process is stubbed for
 * https://gateway.inference.coop/ (./coop-stub) and every request is recorded.
 * Everything else is the real path: Settings, the key going to main, useChat,
 * the tool loop and the stream events.
 */
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dismissOnboarding, dismissOverlay, launchApp, openChat, seedSettings, typeInEditor, waitForAppReady, waitForEditor } from './helpers'
import { sseChunk, type OpenAIStep } from './openai-stub'
import { COOP_GATEWAY, coopRequests, stubCoop } from './coop-stub'

/* eslint-disable @typescript-eslint/no-explicit-any */

const COOP_KEY = 'sk-e2e' + 'c'.repeat(30) + 'COOP'
const DEFAULT_MODEL = 'greenpt/deepseek-v4.1-flash'

let app: ElectronApplication
let page: Page
let userDataDir: string

const requests = () => coopRequests(app)
const stub = (steps: OpenAIStep[], options: { probe?: { status: number; json: unknown } } = {}) => stubCoop(app, steps, options)
/** The chat's turns: streamed requests. The key test's credits probe is not streamed. */
const turns = async () => (await requests()).filter((r) => r.url.endsWith('/chat/completions') && r.body?.stream === true)

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-956-'))
  seedSettings(userDataDir, { toolMode: 'editor' })
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9244' } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  rmSync(userDataDir, { recursive: true, force: true })
})

/** Settings → LLM: add the co-op key, Test it, Save Changes. No other provider has a key, so the co-op is in use. */
async function configureCoop(testSays: string | RegExp = 'API key is valid'): Promise<void> {
  await page.evaluate(() => (window as any).__prose_account.openSettings())
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'LLM' }).click()
  const row = dialog.getByTestId('llm-key-row-inference-coop')
  await row.getByRole('button', { name: 'Add key' }).click()
  await dialog.locator('#apiKey-inference-coop').fill(COOP_KEY)
  await row.getByRole('button', { name: 'Test' }).click()
  await expect(row.getByText(testSays)).toBeVisible()
  await dialog.getByRole('button', { name: 'Save Changes' }).click()
  await expect(dialog).toHaveCount(0)
}

async function ask(prompt: string): Promise<void> {
  await waitForEditor(page)
  await openChat(page)
  await page.evaluate((prompt) => {
    window.dispatchEvent(new CustomEvent('prose:mode-switch-and-run', { detail: { prompt } }))
  }, prompt)
}

test('Settings: the co-op key tests against the gateway, saves in main, and the model list keeps the chat models that take tools', async () => {
  await stub([])
  await configureCoop()

  const [test1] = await requests()
  expect(test1.url).toBe(`${COOP_GATEWAY}/models`)
  expect(test1.auth).toBe(`Bearer ${COOP_KEY}`)

  const settings = await page.evaluate(() => (window as any).api.loadSettings())
  expect(settings.llm.provider).toBe('inference-coop')
  expect(settings.llm.model).toBe(DEFAULT_MODEL)
  expect(settings.llm.keyStatus?.['inference-coop']?.hint).toBe('COOP')
  expect(JSON.stringify(settings)).not.toContain(COOP_KEY)
  expect(readFileSync(join(userDataDir, 'settings.json'), 'utf-8')).not.toContain(COOP_KEY)

  await page.evaluate(() => (window as any).__prose_account.openSettings())
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'LLM' }).click()
  await expect(dialog.getByTestId('llm-key-status-inference-coop')).toContainText('••••••••COOP')
  await dialog.locator('#model').click()
  const options = page.getByRole('option')
  // The picker lists the flagships (#1322), under the one naming scheme.
  await expect(options.filter({ hasText: 'Tinfoil GLM 5.3' })).toHaveCount(1)
  await expect(options.filter({ hasText: 'GreenPT DeepSeek 4.1' })).toHaveCount(1)
  await expect(options.filter({ hasText: 'GLM 5.3 Flash' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Settings lists every chat model, the flagships checked; checking another adds it to the picker.
  const shown = dialog.getByTestId('shown-models-inference-coop')
  await shown.locator('summary').click()
  await expect(shown).toContainText('3 of 4 shown')
  // Left out: the model whose tool calls fail, and everything that isn't a chat model.
  await expect(shown.getByText('greenpt/glm-5.3', { exact: true })).toHaveCount(0)
  await expect(shown.getByText(/embed|whisper|qwen-image/)).toHaveCount(0)
  await shown.getByLabel(/GreenPT GLM 5.3 Flash/).click()
  await expect(shown).toContainText('4 of 4 shown')
  await dialog.locator('#model').click()
  await expect(options.filter({ hasText: 'GreenPT GLM 5.3 Flash' })).toHaveCount(1)
})

test('a chat turn over the co-op: thinking off on every step, and a tool call streamed without an id still pairs with its result', async () => {
  const args = JSON.stringify({ nodeId: 'stale', search: 'The quick fox.', content: 'The quick brown fox.' })
  await stub([
    // Roundtrip 1: a little text, then the tool call in pieces, with no id (as some LiteLLM routes send it).
    [
      sseChunk({ content: 'Let me suggest that.' }),
      sseChunk({ tool_calls: [{ index: 0, type: 'function', function: { name: 'suggest_edit', arguments: args.slice(0, 30) } }] }),
      sseChunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(30) } }] }),
      sseChunk({}, 'tool_calls'),
      'data: [DONE]\n\n',
    ],
    // Roundtrip 2: plain text to close the loop.
    [sseChunk({ content: 'Suggested a change.' }), sseChunk({}, 'stop'), 'data: [DONE]\n\n'],
  ])
  await configureCoop()
  await waitForEditor(page)
  await typeInEditor(page, 'The quick fox.')
  await ask('Add a colour.')

  await expect.poll(async () => (await turns()).length, { timeout: 15_000 }).toBe(2)
  const [first, second] = await turns()
  expect(first.url).toBe(`${COOP_GATEWAY}/chat/completions`)
  expect(first.auth).toBe(`Bearer ${COOP_KEY}`)
  expect(first.body.model).toBe(DEFAULT_MODEL)
  expect(first.body.tools.some((t: any) => t.function.name === 'suggest_edit')).toBe(true)
  // Thinking is off for every co-op model, so the limit carries no reasoning headroom.
  expect(first.body.reasoning_effort).toBe('none')
  expect(second.body.reasoning_effort).toBe('none')
  expect(first.body.max_completion_tokens).toBe(16000)

  const assistant = second.body.messages.find((m: any) => m.role === 'assistant' && m.tool_calls)
  const result = second.body.messages.find((m: any) => m.role === 'tool')
  expect(assistant.tool_calls[0].function).toEqual({ name: 'suggest_edit', arguments: args })
  expect(assistant.tool_calls[0].id).toBeTruthy()
  expect(result.tool_call_id).toBe(assistant.tool_calls[0].id)

  await expect(page.getByText('Suggested a change.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('status-model')).toHaveText('DeepSeek 4.1')
})

test("a spent budget (LiteLLM's budget_exceeded): one request, the credits message, nothing about waiting", async () => {
  const spent = {
    status: 400,
    json: { error: { message: 'Budget has been exceeded! Current cost: 5.01, Max budget: 5.0', type: 'budget_exceeded', param: null, code: '400' } },
  }
  await stub([spent, spent, spent], { probe: spent })
  await configureCoop(/Key is valid, but the Inference Coop account has no credits/)

  await waitForEditor(page)
  await typeInEditor(page, 'The quick fox.')
  await ask('Add a colour.')

  const error = page.getByText("Inference Coop says this key's account has no credits left.")
  await expect(error).toBeVisible({ timeout: 15_000 })
  await expect(error).toContainText('dashboard.inference.coop')
  await expect(page.getByText(/wait a moment/i)).toHaveCount(0)
  await page.waitForTimeout(1_500)
  expect(await turns()).toHaveLength(1)
})
