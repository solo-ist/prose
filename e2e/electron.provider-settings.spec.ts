/**
 * Provider settings, onboarding and models by provider (#1242).
 *
 * Every provider's key is visible and managed on its own row; switching the
 * provider in use touches no key and brings back that provider's model; every
 * model picker lists the provider in use's models; onboarding can start on
 * OpenAI; an OpenAI turn's records read "Prose · GPT-…". OpenAI is stubbed in
 * main (./openai-stub), so CI never calls it.
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

async function chooseProvider(label: string): Promise<void> {
  await dialog().locator('#provider').click()
  await page.getByRole('option', { name: label }).click()
}

async function saveAndClose(): Promise<void> {
  await dialog().getByRole('button', { name: 'Save Changes' }).click()
  await expect(dialog()).toHaveCount(0)
}

/** Settings → LLM: OpenAI in use, its key typed and saved. */
async function useOpenAI(): Promise<void> {
  await openLlmSettings()
  await chooseProvider('OpenAI')
  await dialog().locator('#apiKey-openai').fill(OPENAI_KEY)
  await saveAndClose()
}

test("Settings: every provider's key on its own row; switching keeps both keys and each provider's model; Clear touches one", async () => {
  await launch(true)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await stubOpenAI(app, [], LIVE_MODELS)

  await openLlmSettings()
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
  const anthropicModel = await dialog().locator('#model').textContent()

  // Switch to OpenAI: both keys stay; the live list (with its live-only model) arrives.
  await chooseProvider('OpenAI')
  await expect(status('anthropic')).toContainText('••••••••ANTH')
  await expect(status('openai')).toContainText('••••••••OPEN')
  await dialog().locator('#model').click()
  await expect(page.getByRole('option', { name: 'gpt-5.1' })).toBeVisible()
  await expect(page.getByRole('option', { name: /text-embedding/ })).toHaveCount(0)
  await page.getByRole('option', { name: /GPT-5 mini/ }).click()
  await expect(dialog().locator('#model')).toContainText('GPT-5 mini')

  // Back to Anthropic: its model returns; to OpenAI again: GPT-5 mini returns.
  await chooseProvider('Anthropic')
  await expect(dialog().locator('#model')).toHaveText(anthropicModel ?? '')
  await chooseProvider('OpenAI')
  await expect(dialog().locator('#model')).toContainText('GPT-5 mini')

  // Clear only OpenAI's key.
  await row('openai').getByRole('button', { name: 'Clear' }).click()
  await expect(status('openai')).toHaveText('No key')
  await expect(status('anthropic')).toContainText('••••••••ANTH')
  await saveAndClose()

  settings = await loadSettings()
  expect(settings.llm.provider).toBe('openai')
  expect(settings.llm.model).toBe('gpt-5-mini')
  expect(settings.llm.modelByProvider?.anthropic).toBe('claude-sonnet-5-5')
  expect(Object.keys(settings.llm.keyStatus ?? {})).toEqual(['anthropic'])
})

test("the status bar's model menu lists the provider in use's live models", async () => {
  await launch(true)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await stubOpenAI(app, [], LIVE_MODELS)
  await useOpenAI()

  await page.getByTestId('status-model').click()
  const menu = page.getByRole('menu')
  await expect(menu).toContainText('OpenAI')
  await expect(menu.getByRole('menuitem', { name: 'gpt-5.1' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Claude/ })).toHaveCount(0)
})

test('onboarding: choose OpenAI, verify its key, and start on OpenAI', async () => {
  test.setTimeout(90_000)
  await launch(false)
  await stubOpenAI(app, [], LIVE_MODELS)
  const progress = page.getByTestId('onboarding-progress')
  const primary = page.getByTestId('onboarding-primary')
  const secondary = page.getByTestId('onboarding-secondary')

  await expect(page.getByTestId('onboarding')).toBeVisible()
  await primary.click() // Get started
  await page.getByRole('radio', { name: 'Use AI' }).click()
  await primary.click()
  await expect(progress).toHaveText(/· API key$/i)
  await page.getByRole('radio', { name: 'OpenAI' }).click()
  await expect(page.getByTestId('onboarding')).toContainText('Add your OpenAI key')
  await page.getByLabel('API key').fill(OPENAI_KEY)
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByTestId('onboarding')).toContainText('Key works')
  await primary.click() // Continue
  // Claude, then the default editor; then Done.
  await primary.click()
  await secondary.click()
  await expect(progress).toHaveText(/Done$/i)
  await expect(page.getByTestId('onboarding-summary')).toContainText('On · OpenAI key in Keychain')
  await primary.click()

  const settings = await loadSettings()
  expect(settings.llm.provider).toBe('openai')
  expect(settings.llm.model).toBe('gpt-5')
  expect(settings.llm.keyStatus?.openai?.hint).toBe('OPEN')
  expect(settings.llm.keyStatus?.anthropic).toBeUndefined()
  const [verify] = await openAIRequests(app)
  expect(verify.url).toBe('https://api.openai.com/v1/models')
  expect(verify.auth).toBe(`Bearer ${OPENAI_KEY}`)
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
  // The popover opens from a click on the mark; dispatched, since this case
  // checks the label, not pointer handling (electron.suggestion-popover covers that).
  await mark.dispatchEvent('click')
  await expect(page.getByTestId('suggestion-actor')).toHaveText('By Prose · GPT-5')
})
