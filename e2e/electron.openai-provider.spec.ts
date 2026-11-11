/**
 * OpenAI as a Prose Agents provider (#1241), over the Responses adapter (#1301).
 *
 * The OpenAI API is never called: `fetch` in the main process is stubbed for
 * https://api.openai.com/ (the adapter calls the global `fetch` at request
 * time), and every request is recorded so the cases can check what main sent.
 * Everything else is the real path: Settings, the key going to main, useChat,
 * the tool loop, and the stream events the renderer listens for.
 */
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dismissOnboarding, dismissOverlay, launchApp, openChat, seedSettings, typeInEditor, waitForAppReady, waitForEditor } from './helpers'
import { openAIRequests, rsAnswer, rsCall, rsCallItem, rsCompleted, rsReasoning, rsReasoningItem, rsText, stubOpenAI, type OpenAIStep } from './openai-stub'

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPENAI_KEY = 'sk-proj-e2e' + 'k'.repeat(40) + 'OAIK'

let app: ElectronApplication
let page: Page
let userDataDir: string

const requests = () => openAIRequests(app)
const stub = (steps: OpenAIStep[], options: { probe?: { status: number; json: unknown } } = {}) =>
  stubOpenAI(app, steps, undefined, options)

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1241-'))
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

/** Settings → LLM: add OpenAI's key, Test it, Save Changes. Claude has no key, so OpenAI is in use (#1287). */
async function configureOpenAI(testSays: string | RegExp = 'API key is valid'): Promise<void> {
  await page.evaluate(() => (window as any).__prose_account.openSettings())
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'LLM' }).click()
  const row = dialog.getByTestId('llm-key-row-openai')
  await row.getByRole('button', { name: 'Add key' }).click()
  await dialog.locator('#apiKey-openai').fill(OPENAI_KEY)
  await row.getByRole('button', { name: 'Test' }).click()
  await expect(row.getByText(testSays)).toBeVisible()
  await dialog.getByRole('button', { name: 'Save Changes' }).click()
  await expect(dialog).toHaveCount(0)
}

test('Settings: OpenAI is a provider; its key tests against /models, saves in main, and the model list keeps chat models only', async () => {
  await stub([])
  await configureOpenAI()

  const [test1] = await requests()
  expect(test1.url).toBe('https://api.openai.com/v1/models')
  expect(test1.auth).toBe(`Bearer ${OPENAI_KEY}`)

  const settings = await page.evaluate(() => (window as any).api.loadSettings())
  expect(settings.llm.provider).toBe('openai')
  expect(settings.llm.keyStatus?.openai?.hint).toBe('OAIK')
  expect(settings.llm.keyStatus?.anthropic).toBeUndefined()
  expect(JSON.stringify(settings)).not.toContain(OPENAI_KEY)
  expect(readFileSync(join(userDataDir, 'settings.json'), 'utf-8')).not.toContain(OPENAI_KEY)

  // Reopening fetches the live list with the saved key (main reads it).
  await page.evaluate(() => (window as any).__prose_account.openSettings())
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'LLM' }).click()
  await expect(dialog.getByTestId('llm-key-status-openai')).toContainText('••••••••OAIK')
  await expect.poll(async () => (await requests()).filter((r) => r.url.endsWith('/models')).length).toBeGreaterThanOrEqual(2)
  await dialog.locator('#model').click()
  const options = page.getByRole('option')
  await expect(options.filter({ hasText: 'GPT-5 mini' })).toHaveCount(1)
  await expect(options.filter({ hasText: 'text-embedding-3-small' })).toHaveCount(0)
  await expect(options.filter({ hasText: 'whisper-1' })).toHaveCount(0)
  // Tab emoji stay Anthropic-only: no Anthropic key, so the switch is off.
  await page.keyboard.press('Escape')
  await expect(dialog.locator('#emojiIcons')).toBeDisabled()
})

/** The chat's turns: streamed requests to /responses. The key test's credits probe is not streamed (#1268). */
const turns = async () => (await requests()).filter((r) => r.url.endsWith('/responses') && r.body?.stream === true)

async function ask(prompt: string): Promise<void> {
  await waitForEditor(page)
  await openChat(page)
  await page.evaluate((prompt) => {
    window.dispatchEvent(new CustomEvent('prose:mode-switch-and-run', { detail: { prompt } }))
  }, prompt)
}

test('a chat turn over OpenAI: it reasons and calls suggest_edit in one turn; the thought process shows, and the reasoning goes back with the tool result', async () => {
  const args = JSON.stringify({ nodeId: 'stale', search: 'The quick fox.', content: 'The quick brown fox.' })
  const reasoning = { id: 'rs_1', summary: ['The sentence wants ', 'a colour.'], encrypted: 'gAAAAenc' }
  const call = { id: 'fc_1', callId: 'call_1', name: 'suggest_edit', args: [args.slice(0, 20), args.slice(20, 50), args.slice(50)] }
  await stub([
    // Roundtrip 1: reasoning, a little text, then the tool call in pieces.
    [...rsReasoning(reasoning, 0), ...rsText('Let me ', 'suggest that.'), ...rsCall(call, 2), rsCompleted()],
    // Roundtrip 2: plain text to close the loop.
    rsAnswer('Suggested a change.'),
  ])
  await configureOpenAI()
  await waitForEditor(page)
  await typeInEditor(page, 'The quick fox.')
  // GPT-5 reasons, so the thinking toggle is there, and on.
  await expect(page.getByRole('button', { name: 'Extended thinking on' })).toBeVisible()
  await ask('Add a colour.')

  await expect.poll(async () => (await turns()).length, { timeout: 15_000 }).toBe(2)
  const [first, second] = await turns()

  expect(first.url).toBe('https://api.openai.com/v1/responses')
  expect(first.auth).toBe(`Bearer ${OPENAI_KEY}`)
  expect(first.body.model).toBe('gpt-5')
  expect(first.body.stream).toBe(true)
  // Stateless: nothing is stored at OpenAI, and the system prompt is not an input item.
  expect(first.body.store).toBe(false)
  expect(typeof first.body.instructions).toBe('string')
  expect(first.body.input.at(-1)).toEqual({ role: 'user', content: 'Add a colour.' })
  expect(first.body.tools.map((t: any) => t.type)).toEqual(first.body.tools.map(() => 'function'))
  expect(first.body.tools.some((t: any) => t.name === 'suggest_edit' && t.strict === false)).toBe(true)
  expect(first.body).not.toHaveProperty('thinking')
  // Tools and reasoning together, on every step, with room for the reasoning in the limit.
  expect(first.body.reasoning).toEqual({ effort: 'medium', summary: 'auto' })
  expect(second.body.reasoning).toEqual({ effort: 'medium', summary: 'auto' })
  expect(first.body.max_output_tokens).toBe(32000)

  // The tool round goes back as OpenAI sent it: the reasoning item, then the call, then its result.
  const items = second.body.input as any[]
  const at = items.findIndex((i) => i.type === 'reasoning')
  expect(items[at]).toEqual(rsReasoningItem(reasoning))
  expect(items[at + 1]).toEqual(rsCallItem(call))
  expect(items[at + 2].type).toBe('function_call_output')
  expect(items[at + 2].call_id).toBe('call_1')
  expect(typeof items[at + 2].output).toBe('string')

  // The suggestion is in the document, over the original text.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = (window as any).__prose_editor
        let found = ''
        editor.state.doc.descendants((node: any) => {
          if (node.isText && node.marks.some((m: any) => m.type.name === 'aiSuggestion')) found += node.text
        })
        return found
      })
    )
    .toContain('The quick fox.')
  await expect(page.getByText('Suggested a change.')).toBeVisible()
  // The reasoning summary is the turn's thought process.
  await expect(page.getByText('Thought process').first()).toBeVisible()
})

test('thinking off asks for the least reasoning; a model that refuses that effort is asked again with one it lists, and the writer sees only the answer', async () => {
  const refusal = {
    status: 400,
    json: {
      error: {
        message: "Unsupported value: 'reasoning.effort' does not support 'minimal' with this model. Supported values are: 'low', 'medium', 'high', and 'xhigh'.",
        type: 'invalid_request_error',
        param: 'reasoning.effort',
        code: 'unsupported_value',
      },
    },
  }
  await stub([refusal, rsAnswer('Hello.'), rsAnswer('Hello again.')])
  await configureOpenAI()
  await page.getByRole('button', { name: 'Extended thinking on' }).click()
  await expect(page.getByRole('button', { name: 'Extended thinking off' })).toBeVisible()

  await ask('Hi.')
  await expect(page.getByText('Hello.', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Unsupported value/)).toHaveCount(0)
  await ask('Hi again.')
  await expect(page.getByText('Hello again.')).toBeVisible({ timeout: 15_000 })
  // No summary is asked for with thinking off; the refused effort is not tried twice.
  expect((await turns()).map((t) => t.body.reasoning)).toEqual([{ effort: 'minimal' }, { effort: 'low' }, { effort: 'low' }])
})

test('an account with no credits (HTTP 429 insufficient_quota): one request, the credits message, nothing about waiting (#1268)', async () => {
  const noCredits = {
    status: 429,
    json: {
      error: {
        message: 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
        type: 'insufficient_quota',
        param: null,
        code: 'insufficient_quota',
      },
    },
  }
  // The chat turn and the key test's credits probe both meet the empty account.
  await stub([noCredits, noCredits, noCredits], { probe: noCredits })
  // The key is valid, so it saves; the test says the account has no credits.
  await configureOpenAI(/Key is valid, but the OpenAI account has no credits/)

  await waitForEditor(page)
  await typeInEditor(page, 'The quick fox.')
  await ask('Add a colour.')

  const error = page.getByText("OpenAI says this key's account has no credits left.")
  await expect(error).toBeVisible({ timeout: 15_000 })
  await expect(error).toContainText('platform.openai.com → Settings → Billing')
  await expect(page.getByText(/wait a moment/i)).toHaveCount(0)
  await expect(page.getByText(/rate limit/i)).toHaveCount(0)
  // Not retried: exactly one streamed request reached OpenAI.
  await page.waitForTimeout(1_500)
  expect(await turns()).toHaveLength(1)
})

test("a model that doesn't reason (gpt-4.1) gets no reasoning setting, the plain limit and no thinking toggle", async () => {
  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1271-'))
  // OpenAI's remembered model is gpt-4.1, so OpenAI's first key brings it back.
  seedSettings(userDataDir, {
    toolMode: 'editor',
    llm: { provider: 'anthropic', model: 'claude-sonnet-5-5', modelByProvider: { openai: 'gpt-4.1' } },
  })
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DEBUG_PORT: '9244' } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await stub([rsAnswer('Hello.')])
  await configureOpenAI()
  await expect(page.getByRole('button', { name: /Extended thinking/ })).toHaveCount(0)

  await ask('Hi.')
  await expect(page.getByText('Hello.')).toBeVisible({ timeout: 15_000 })
  const [turn] = await turns()
  expect(turn.body.model).toBe('gpt-4.1')
  expect(turn.body).not.toHaveProperty('reasoning')
  expect(turn.body.max_output_tokens).toBe(16000)
})
