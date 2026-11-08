/**
 * OpenAI as a Prose Agents provider, over the Chat Completions adapter (#1241).
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
import { openAIRequests, sseChunk, stubOpenAI, type OpenAIStep } from './openai-stub'

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

/** Settings → LLM: choose OpenAI, type the key, Test it, Save Changes. */
async function configureOpenAI(testSays: string | RegExp = 'API key is valid'): Promise<void> {
  await page.evaluate(() => (window as any).__prose_account.openSettings())
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'LLM' }).click()
  await dialog.locator('#provider').click()
  await page.getByRole('option', { name: 'OpenAI' }).click()
  // OpenAI is now in use and has no key, so its row opens on the field (#1242).
  const row = dialog.getByTestId('llm-key-row-openai')
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

test('a chat turn over OpenAI: a suggest_edit call split across chunks leaves a suggestion, and its result goes back as a tool message', async () => {
  const args = JSON.stringify({ nodeId: 'stale', search: 'The quick fox.', content: 'The quick brown fox.' })
  await stub([
    // Roundtrip 1: a little text, then the tool call in pieces.
    [
      sseChunk({ role: 'assistant', content: 'Let me ' }),
      sseChunk({ content: 'suggest that.' }),
      sseChunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'suggest_edit', arguments: '' } }] }),
      sseChunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(0, 20) } }] }),
      sseChunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(20, 50) } }] }),
      sseChunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(50) } }] }),
      sseChunk({}, 'tool_calls'),
      'data: [DONE]\n\n',
    ],
    // Roundtrip 2: plain text to close the loop.
    [sseChunk({ content: 'Suggested a change.' }), sseChunk({}, 'stop'), 'data: [DONE]\n\n'],
  ])
  await configureOpenAI()
  await waitForEditor(page)
  await typeInEditor(page, 'The quick fox.')
  await openChat(page)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('prose:mode-switch-and-run', { detail: { prompt: 'Add a colour.' } }))
  })

  // Streamed requests are the chat's; the key test's credits probe is not streamed (#1268).
  const chatRequests = async () => (await requests()).filter((r) => r.url.endsWith('/chat/completions') && r.body?.stream === true)
  await expect.poll(async () => (await chatRequests()).length, { timeout: 15_000 }).toBe(2)
  const [first, second] = await chatRequests()

  expect(first.auth).toBe(`Bearer ${OPENAI_KEY}`)
  expect(first.body.model).toBe('gpt-5')
  expect(first.body.stream).toBe(true)
  expect(first.body.messages[0].role).toBe('system')
  expect(first.body.messages.at(-1)).toEqual({ role: 'user', content: 'Add a colour.' })
  expect(first.body.tools.map((t: any) => t.type)).toEqual(first.body.tools.map(() => 'function'))
  expect(first.body.tools.some((t: any) => t.function.name === 'suggest_edit')).toBe(true)
  expect(first.body).not.toHaveProperty('thinking')
  // gpt-5 reasons: low effort on every step, with room for the reasoning in the limit (#1271).
  expect(first.body.reasoning_effort).toBe('low')
  expect(second.body.reasoning_effort).toBe('low')
  expect(first.body.max_completion_tokens).toBe(24000)

  const assistant = second.body.messages.find((m: any) => m.role === 'assistant' && m.tool_calls)
  expect(assistant.tool_calls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'suggest_edit', arguments: args } }])
  const toolMessage = second.body.messages.find((m: any) => m.role === 'tool')
  expect(toolMessage.tool_call_id).toBe('call_1')
  expect(typeof toolMessage.content).toBe('string')

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
  await openChat(page)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('prose:mode-switch-and-run', { detail: { prompt: 'Add a colour.' } }))
  })

  const error = page.getByText("OpenAI says this key's account has no credits left.")
  await expect(error).toBeVisible({ timeout: 15_000 })
  await expect(error).toContainText('platform.openai.com → Settings → Billing')
  await expect(page.getByText(/wait a moment/i)).toHaveCount(0)
  await expect(page.getByText(/rate limit/i)).toHaveCount(0)
  // Not retried: exactly one streamed request reached OpenAI.
  await page.waitForTimeout(1_500)
  const streamed = (await requests()).filter((r) => r.url.endsWith('/chat/completions') && r.body?.stream === true)
  expect(streamed).toHaveLength(1)
})

test("a model that doesn't reason (gpt-4.1) gets no reasoning_effort and the plain limit (#1271)", async () => {
  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1271-'))
  // OpenAI's remembered model is gpt-4.1, so choosing OpenAI selects it.
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
  await stub([[sseChunk({ content: 'Hello.' }), sseChunk({}, 'stop'), 'data: [DONE]\n\n']])
  await configureOpenAI()

  await waitForEditor(page)
  await openChat(page)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('prose:mode-switch-and-run', { detail: { prompt: 'Hi.' } }))
  })
  await expect(page.getByText('Hello.')).toBeVisible({ timeout: 15_000 })
  const [turn] = (await requests()).filter((r) => r.url.endsWith('/chat/completions') && r.body?.stream === true)
  expect(turn.body.model).toBe('gpt-4.1')
  expect(turn.body).not.toHaveProperty('reasoning_effort')
  expect(turn.body.max_completion_tokens).toBe(16000)
})
