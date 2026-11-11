/**
 * Provider settings, onboarding and models by provider (#1242), both providers
 * side by side (#1287).
 *
 * Every provider's key is visible and managed on its own row; one model list
 * holds every keyed provider's models, and a pick sets the provider with the
 * model; a provider without a key offers "Add a key", never a model that would
 * fail; onboarding takes a key per provider; an OpenAI turn's records read
 * "Prose · GPT-…". OpenAI is stubbed in main (./openai-stub), so CI never
 * calls it.
 */
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dismissOnboarding, dismissOverlay, launchApp, openChat, seedSettings, typeInEditor, waitForAppReady, waitForEditor } from './helpers'
import { openAIRequests, sseChunk, stubOpenAI } from './openai-stub'

/* eslint-disable @typescript-eslint/no-explicit-any */

const ANTHROPIC_KEY = 'sk-ant-api03-e2e' + 'a'.repeat(50) + 'ANTH'
const OPENAI_KEY = 'sk-proj-e2e' + 'o'.repeat(40) + 'OPEN'
/** A live-only id, absent from the seed: proves a list came from the provider. */
const LIVE_MODELS = ['gpt-5', 'gpt-5-mini', 'gpt-5.1', 'text-embedding-3-small']

let app: ElectronApplication
let page: Page
let userDataDir: string
let docsDir: string

async function launch(seed: boolean): Promise<void> {
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1242-'))
  docsDir = mkdtempSync(join(tmpdir(), 'prose-1242-docs-'))
  if (seed) seedSettings(userDataDir, { toolMode: 'editor' })
  const launched = await launchApp({
    env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_DOCS_DIR: docsDir, PROSE_DEBUG_PORT: '9244' },
  })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
}

test.afterEach(async () => {
  await app?.close().catch(() => {})
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(docsDir, { recursive: true, force: true })
})

const loadSettings = () => page.evaluate(() => (window as any).api.loadSettings())
const dialog = () => page.getByRole('dialog')
const status = (provider: string) => dialog().getByTestId(`llm-key-status-${provider}`)
const row = (provider: string) => dialog().getByTestId(`llm-key-row-${provider}`)

async function openLlmSettings(): Promise<void> {
  await page.evaluate(() => (window as any).__prose_account.openSettings())
  await dialog().getByRole('tab', { name: 'LLM' }).click()
}

/** Settings → LLM's model list: pick the option named `name`. */
async function pickModel(name: string | RegExp): Promise<void> {
  await dialog().locator('#model').click()
  await page.getByRole('option', { name }).click()
}

async function saveAndClose(): Promise<void> {
  await dialog().getByRole('button', { name: 'Save Changes' }).click()
  await expect(dialog()).toHaveCount(0)
}

/** Settings → LLM: only OpenAI's key typed and saved, so OpenAI is in use. */
async function useOpenAI(): Promise<void> {
  await openLlmSettings()
  await row('openai').getByRole('button', { name: 'Add key' }).click()
  await dialog().locator('#apiKey-openai').fill(OPENAI_KEY)
  await saveAndClose()
}

/** Settings → LLM: both keys typed and saved; Anthropic's lands first, so Claude stays in use. */
async function saveBothKeys(): Promise<void> {
  await openLlmSettings()
  await dialog().locator('#apiKey-anthropic').fill(ANTHROPIC_KEY)
  await row('openai').getByRole('button', { name: 'Add key' }).click()
  await dialog().locator('#apiKey-openai').fill(OPENAI_KEY)
  await saveAndClose()
}

const hello = (text: string): string[] => [sseChunk({ content: text }), sseChunk({}, 'stop'), 'data: [DONE]\n\n']

/** Send "Hi." from the chat panel's run path. */
async function chat(): Promise<void> {
  // A closing menu or dialog hides the page from role queries until it is gone.
  await expect(page.locator('[role="menu"], [role="alertdialog"]')).toHaveCount(0)
  await waitForEditor(page)
  await openChat(page)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('prose:mode-switch-and-run', { detail: { prompt: 'Hi.' } }))
  })
}

const streamedTurns = async () =>
  (await openAIRequests(app)).filter((r) => r.url.endsWith('/chat/completions') && r.body?.stream === true)

test('Settings: one model list across providers; a pick sets the provider; Clear moves off a provider that lost its key', async () => {
  await launch(true)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await stubOpenAI(app, [], LIVE_MODELS)

  await openLlmSettings()
  // No Provider select: the model list is where a provider is chosen.
  await expect(dialog().locator('#provider')).toHaveCount(0)
  // No key yet: each provider offers "Add a key", and nothing that would fail.
  await expect(dialog().locator('#model')).toContainText('Add a key below to choose a model')
  await dialog().locator('#model').click()
  await expect(page.getByTestId('model-add-key-anthropic')).toHaveText('Add an Anthropic key below to use its models.')
  await expect(page.getByTestId('model-add-key-openai')).toHaveText('Add an OpenAI key below to use its models.')
  await expect(page.getByRole('option')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Anthropic is in use with no key, so its field is open; OpenAI waits behind "Add key".
  await expect(status('anthropic')).toHaveText('No key')
  await expect(status('openai')).toHaveText('No key')
  await dialog().locator('#apiKey-anthropic').fill(ANTHROPIC_KEY)
  await row('openai').getByRole('button', { name: 'Add key' }).click()
  await dialog().locator('#apiKey-openai').fill(OPENAI_KEY)
  await saveAndClose()

  let settings = await loadSettings()
  expect(settings.llm.keyStatus?.anthropic?.hint).toBe('ANTH')
  expect(settings.llm.keyStatus?.openai?.hint).toBe('OPEN')
  expect(JSON.stringify(settings)).not.toContain(ANTHROPIC_KEY)
  expect(JSON.stringify(settings)).not.toContain(OPENAI_KEY)

  await openLlmSettings()
  await expect(status('anthropic')).toContainText('••••••••ANTH')
  await expect(status('openai')).toContainText('••••••••OPEN')
  // Both providers in one list: Claude's models beside OpenAI's live list (with its live-only model).
  await dialog().locator('#model').click()
  await expect(page.getByRole('option', { name: /Claude Sonnet 5.5/ })).toBeVisible()
  await expect(page.getByRole('option', { name: 'gpt-5.1' })).toBeVisible()
  await expect(page.getByRole('option', { name: /text-embedding/ })).toHaveCount(0)
  await page.getByRole('option', { name: /GPT-5 mini/ }).click()
  await expect(dialog().locator('#model')).toContainText('GPT-5 mini')
  await expect(row('openai')).toContainText('in use')

  // A Claude model from the same list: the provider follows.
  await pickModel(/Claude Opus 5.5/)
  await expect(dialog().locator('#model')).toContainText('Claude Opus 5.5')
  await expect(row('anthropic')).toContainText('in use')

  // On OpenAI again, clear its key: Prose Agents move to Anthropic, with its model.
  await pickModel(/GPT-5 mini/)
  await row('openai').getByRole('button', { name: 'Clear' }).click()
  await expect(status('openai')).toHaveText('No key')
  await expect(status('anthropic')).toContainText('••••••••ANTH')
  await expect(dialog().locator('#model')).toContainText('Claude Opus 5.5')
  await saveAndClose()

  settings = await loadSettings()
  expect(settings.llm.provider).toBe('anthropic')
  expect(settings.llm.model).toBe('claude-opus-5-5')
  expect(settings.llm.modelByProvider?.openai).toBe('gpt-5-mini')
  expect(Object.keys(settings.llm.keyStatus ?? {})).toEqual(['anthropic'])
})

test('Settings: a custom model id takes its provider', async () => {
  await launch(true)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await stubOpenAI(app, [], LIVE_MODELS)
  await saveBothKeys()

  await openLlmSettings()
  await dialog().getByRole('button', { name: 'Use custom model' }).click()
  await dialog().locator('#customModelProvider').click()
  await page.getByRole('option', { name: 'OpenAI' }).click()
  // Typed through a listed id ("gpt-5") on the way: the field stays open.
  await dialog().locator('#model').fill('')
  await dialog().locator('#model').pressSequentially('gpt-5-2026-08-01')
  await saveAndClose()

  const settings = await loadSettings()
  expect(settings.llm.provider).toBe('openai')
  expect(settings.llm.model).toBe('gpt-5-2026-08-01')
  await openLlmSettings()
  await expect(dialog().locator('#model')).toHaveValue('gpt-5-2026-08-01')
  await expect(dialog().locator('#customModelProvider')).toContainText('OpenAI')
})

test("the status bar's model menu lists both providers; a GPT pick with Claude in use sends the next turn to OpenAI", async () => {
  test.setTimeout(90_000)
  await launch(true)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await stubOpenAI(app, [hello('Hello from GPT.')], LIVE_MODELS)
  await saveBothKeys()

  const model = page.getByTestId('status-model')
  await expect(model).toHaveText('Sonnet 5.5')
  await model.click()
  const menu = page.getByRole('menu')
  await expect(menu).toContainText('Anthropic')
  await expect(menu).toContainText('OpenAI')
  await expect(menu.getByRole('menuitem', { name: /Claude Sonnet 5.5/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /text-embedding/ })).toHaveCount(0)
  await menu.getByRole('menuitem', { name: 'gpt-5.1' }).click()
  await expect(model).toHaveText('gpt-5.1')

  await chat()
  await expect(page.getByText('Hello from GPT.')).toBeVisible({ timeout: 15_000 })
  const [turn] = await streamedTurns()
  expect(turn.body.model).toBe('gpt-5.1')
  expect(turn.auth).toBe(`Bearer ${OPENAI_KEY}`)
  const settings = await loadSettings()
  expect(settings.llm.provider).toBe('openai')
  expect(settings.llm.model).toBe('gpt-5.1')
  expect(settings.llm.modelByProvider?.anthropic).toBe('claude-sonnet-5-5')
})

test('with one key, the other provider offers "Add a key", which opens Settings → LLM', async () => {
  await launch(true)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await stubOpenAI(app, [], LIVE_MODELS)
  await useOpenAI()

  // The first key saved picked its provider: Claude had none.
  await expect(page.getByTestId('status-model')).toHaveText('GPT-5')
  await page.getByTestId('status-model').click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'gpt-5.1' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Claude/ })).toHaveCount(0)
  const add = page.getByTestId('status-model-add-key-anthropic')
  await expect(add).toHaveText('Add an Anthropic key in Settings → LLM')
  await add.click()
  await expect(dialog().getByRole('tab', { name: 'LLM' })).toHaveAttribute('data-state', 'active')
  await expect(row('anthropic')).toBeVisible()
})

test('onboarding: a key per provider; the first one verified picks the provider; Done names both; chat works without Settings', async () => {
  test.setTimeout(90_000)
  await launch(false)
  await stubOpenAI(app, [hello('Hello from GPT.')], LIVE_MODELS)
  const onboarding = page.getByTestId('onboarding')
  const progress = page.getByTestId('onboarding-progress')
  const primary = page.getByTestId('onboarding-primary')
  const secondary = page.getByTestId('onboarding-secondary')

  await expect(onboarding).toBeVisible()
  await primary.click() // Get started
  await page.getByRole('radio', { name: 'Use AI' }).click()
  await primary.click()
  await expect(progress).toHaveText(/· API keys$/i)
  await expect(onboarding).toContainText('Add your API keys')
  // No provider choice: a field per provider, each with its own Verify.
  await expect(page.getByRole('radio', { name: 'OpenAI' })).toHaveCount(0)
  await expect(primary).toBeDisabled()

  // OpenAI first, through its real check (stubbed at the network): Claude has no key, so OpenAI is in use.
  const openai = page.getByTestId('onboarding-key-row-openai')
  await page.getByLabel('OpenAI API key').fill(OPENAI_KEY)
  await openai.getByRole('button', { name: 'Verify' }).click()
  await expect(openai).toContainText('Key works. Saved to Keychain.')
  await expect(primary).toBeEnabled()

  // The Anthropic SDK brings its own fetch, so main's key check answers for it here.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('settings:testApiKey')
    ipcMain.handle('settings:testApiKey', async (_event, request: { provider: string }) =>
      request.provider === 'anthropic'
        ? { success: true, message: 'API key is valid' }
        : { success: false, message: 'Only the Anthropic check is stubbed' })
  })
  const anthropic = page.getByTestId('onboarding-key-row-anthropic')
  await page.getByLabel('Anthropic API key').fill(ANTHROPIC_KEY)
  await anthropic.getByRole('button', { name: 'Verify' }).click()
  await expect(anthropic).toContainText('Key works. Saved to Keychain.')
  await expect(openai).toContainText('Key works. Saved to Keychain.')

  await primary.click() // Continue
  // Claude, then the default editor; then Done.
  await primary.click()
  await secondary.click()
  await expect(progress).toHaveText(/Done$/i)
  await expect(page.getByTestId('onboarding-summary')).toContainText('On · Anthropic and OpenAI keys in Keychain')
  await primary.click()

  const settings = await loadSettings()
  expect(settings.llm.provider).toBe('openai')
  expect(settings.llm.model).toBe('gpt-5')
  expect(settings.llm.keyStatus?.openai?.hint).toBe('OPEN')
  expect(settings.llm.keyStatus?.anthropic?.hint).toBe('ANTH')
  const [verify] = await openAIRequests(app)
  expect(verify.url).toBe('https://api.openai.com/v1/models')
  expect(verify.auth).toBe(`Bearer ${OPENAI_KEY}`)

  // Straight from Done to a reply: no Settings visit.
  await dismissOverlay(page).catch(() => {})
  await chat()
  await expect(page.getByText('Hello from GPT.')).toBeVisible({ timeout: 15_000 })
  const [turn] = await streamedTurns()
  expect(turn.body.model).toBe('gpt-5')
})

test("an OpenAI turn's suggestion reads \"By Prose · GPT-5\"", async () => {
  test.setTimeout(90_000)
  await launch(true)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  const args = JSON.stringify({ nodeId: 'stale', search: 'The quick fox.', content: 'The quick brown fox.' })
  await stubOpenAI(app, [
    [
      sseChunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'suggest_edit', arguments: args } }] }),
      sseChunk({}, 'tool_calls'),
      'data: [DONE]\n\n',
    ],
    [sseChunk({ content: 'Done.' }), sseChunk({}, 'stop'), 'data: [DONE]\n\n'],
  ], LIVE_MODELS)
  await useOpenAI()
  await waitForEditor(page)
  await typeInEditor(page, 'The quick fox.')
  await openChat(page)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('prose:mode-switch-and-run', { detail: { prompt: 'Add a colour.' } }))
  })

  const mark = page.locator('.ai-suggestion-mark').first()
  await expect(mark).toBeVisible({ timeout: 15_000 })
  // A real click, with focus still in the chat input: the blurred editor's
  // selection highlight sits over the mark and must not swallow the click (#1264).
  await mark.click()
  await expect(page.getByTestId('suggestion-actor')).toHaveText('By Prose · GPT-5')
})
