/**
 * Marketing screenshot generator (temporary — not part of the test suite).
 * Run: npx playwright test electron.screenshots --workers=1
 *
 * Isolated, seeded instance (Prose theme) → README hero + App Store scenes
 * 1 and 3 to 7. Scene 2 (the chat mode-switch) is a separate spec. Light hero,
 * then alternating dark/light.
 *
 * Demo content: the real blog post fixture (e2e/fixtures/a-chorus-of-human-voices.md),
 * with a few obvious typos injected (below the hero fold) for the review/activity demos.
 */
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  executeProseTool,
  seedSettings,
  drawWindowButtons,
} from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')
const FIXTURE = join(REPO, 'e2e/fixtures/a-chorus-of-human-voices.md')
const HERO_NAME = 'A Chorus of Human Voices.md'
const LEVERAGE_NAME = 'The Great Leverage Inversion.md'
const SHOTS = '/tmp/prose-shots'
const WRITER = 'Angel Marino'
// Never sent anywhere useful: they only make each provider read as keyed, so
// the model menu lists all three. Held in main's memory for this launch.
const DEMO_KEYS: Array<[string, string]> = [
  ['anthropic', 'sk-ant-demo-screenshot-key'],
  ['openai', 'sk-demo-screenshot-key'],
  ['inference-coop', 'sk-demo-screenshot-key'],
]

// Generator — excluded from the normal e2e suite; opt in with SHOOT=1.
test.skip(process.env.SHOOT !== '1', 'marketing screenshot generator (run with SHOOT=1)')

let app: ElectronApplication
let page: Page
let docsDir: string
let essays: string
let profile: string

function uuid(n: number): string {
  return `0000000${n}-0000-4000-8000-00000000000${n}`.slice(0, 36)
}

interface DocNode { id: string; type?: string; content?: string; children?: DocNode[] }
const flatten = (nodes: DocNode[]): DocNode[] =>
  nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])])

async function nodeIncluding(text: string): Promise<DocNode> {
  const doc = await executeProseTool(page, 'read_document', {})
  const node = flatten((doc.data as { nodes: DocNode[] }).nodes).find((n) =>
    (n.content ?? '').includes(text),
  )
  expect(node, `node containing "${text}"`).toBeTruthy()
  return node!
}

// Returns the new suggestionId. Calls the seam directly so provenance.model is
// set (executeProseTool drops the 4th arg → "Unknown" in the Activity panel).
async function suggest(
  marker: string,
  replace: (s: string) => string,
  comment: string,
  model = 'claude-sonnet-5-5',
): Promise<string> {
  const node = await nodeIncluding(marker)
  const res = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ nodeId, content, search, comment, model }: any) =>
      (window as any).__prose_tools.executeTool(
        'suggest_edit',
        { nodeId, content, search, comment },
        'create',
        // The actor names the provider; a bare model is read as Anthropic's.
        { model, actor: { kind: 'prose-agent', provider: model.startsWith('gpt-') ? 'openai' : 'anthropic', model } },
      ),
    { nodeId: node.id, content: replace(node.content ?? ''), search: node.content, comment, model },
  )
  expect((res as { success: boolean }).success).toBe(true)
  return (res as { data: { suggestionId: string } }).data.suggestionId
}

async function setMode(mode: 'light' | 'dark'): Promise<void> {
  // The fresh-install pairing: Mono in light, Prose in dark. Mono has no class.
  await page.evaluate((m) => {
    document.documentElement.classList.toggle('dark', m === 'dark')
    document.documentElement.classList.toggle('theme-prose', m === 'dark')
  }, mode)
  await page.waitForTimeout(300)
}

async function setFilesVisible(visible: boolean): Promise<void> {
  const show = page.locator('[aria-label="Show files"]')
  const hide = page.locator('[aria-label="Hide files"]')
  if (visible && (await show.isVisible({ timeout: 800 }).catch(() => false))) await show.click()
  if (!visible && (await hide.isVisible({ timeout: 800 }).catch(() => false))) await hide.click()
  await page.waitForTimeout(300)
}

async function selectView(view: 'projects' | 'favorites'): Promise<void> {
  await setFilesVisible(true)
  const label = view === 'projects' ? 'Projects' : 'Favorites'
  const btn = page.locator(`[aria-label="${label}"]`)
  if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await btn.click()
  } else {
    const more = page.locator('[data-testid="file-list-panel"] [aria-label="More options"]')
    if (await more.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await more.click()
      await page.getByRole('menuitem', { name: label }).click()
    }
  }
  await page.waitForTimeout(400)
}

async function closeChat(): Promise<void> {
  const hide = page.locator('[aria-label="Hide chat"]')
  if (await hide.isVisible({ timeout: 1_000 }).catch(() => false)) await hide.click()
  await page.waitForTimeout(300)
}

async function openDoc(path: string): Promise<void> {
  const opened = await executeProseTool(page, 'open_file', { path })
  expect(opened.success).toBe(true)
  await waitForEditor(page)
}

const openHero = (): Promise<void> => openDoc(join(essays, HERO_NAME))

async function scrollTop(): Promise<void> {
  await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    const sc = pm?.closest('[class*="overflow"]') as HTMLElement | null
    if (sc) sc.scrollTop = 0
  })
}

// open_file re-focuses an already-open tab without reloading, so scenes share
// one doc/tab. Clear any pending suggestions a prior scene left before seeding,
// keeping each suggestion scene independent (and the tab bar clean).
async function clearSuggestions(): Promise<void> {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__prose_editor?.commands?.rejectAllAISuggestions?.()
  })
  await page.waitForTimeout(250)
}

// Put the writer's selection on `text` (or the caret before it), so the next
// keystrokes land there. Finds it inside one text block; tracked deletions stay
// in the document, so the offsets hold while changes are pending.
async function selectText(text: string, caretBefore = false): Promise<void> {
  const found = await page.evaluate(
    ({ text, caretBefore }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      let range: { from: number; to: number } | null = null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.state.doc.descendants((node: any, pos: number) => {
        if (range || !node.isTextblock) return
        const at = node.textContent.indexOf(text)
        if (at >= 0) range = { from: pos + 1 + at, to: pos + 1 + at + text.length }
      })
      if (!range) return false
      const { from, to } = range as { from: number; to: number }
      editor.chain().focus().setTextSelection(caretBefore ? from : { from, to }).run()
      return true
    },
    { text, caretBefore },
  )
  expect(found, `text "${text}" in the document`).toBe(true)
}

// Focused typo/grammar copyedits — first the post's real issues, then a few
// obvious injected typos. All single-purpose (no tone/style changes).
async function seedCopyedits(): Promise<string[]> {
  const ids: string[] = []
  ids.push(await suggest('a interesting', (s) => s.replace('a interesting', 'an interesting').replace(/the the /g, 'the '), "Grammar — 'an', and a doubled word."))
  ids.push(await suggest('trainning', (s) => s.replace('trainning', 'training'), 'Typo.'))
  ids.push(await suggest('corpis', (s) => s.replace('corpis', 'corpus'), 'Typo.'))
  return ids
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  mkdirSync(SHOTS, { recursive: true })
  profile = mkdtempSync(join(tmpdir(), 'prose-shots-profile-'))
  docsDir = mkdtempSync(join(tmpdir(), 'prose-shots-docs-'))

  essays = join(docsDir, 'Essays')
  const notes = join(docsDir, 'Field Notes')
  mkdirSync(essays, { recursive: true })
  mkdirSync(notes, { recursive: true })
  // Faithful fixture keeps frontmatter; the screenshot copy drops it (title
  // leads) and gets a few obvious typos injected below the hero fold.
  let heroBody = readFileSync(FIXTURE, 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, '')
  heroBody = heroBody
    .replace('outside of the training data', 'outside of the trainning data')
    .replace('the entire corpus of human thought', 'the entire corpis of human thought')
    .replace('the dreaded slopification', 'the dredded slopification')
  writeFileSync(join(essays, HERO_NAME), heroBody)
  writeFileSync(join(essays, LEVERAGE_NAME), '# The Great Leverage Inversion\n\nDraft.\n')
  writeFileSync(join(essays, 'Notes on Craft.md'), '# Notes on Craft\n\nDraft.\n')
  writeFileSync(join(notes, '2025 Reading.md'), '# 2025 Reading\n\n- ...\n')
  writeFileSync(join(notes, 'Ideas.md'), '# Ideas\n\n- ...\n')

  seedSettings(profile, {
      appearance: { lightColor: 'mono', darkColor: 'prose', mode: 'light', icon: 'pilcrow' },
      aiConsent: { consented: true, consentedAt: '2025-01-01T00:00:00.000Z' },
      llm: { provider: 'anthropic', apiKey: 'sk-ant-demo-screenshot-key', model: 'claude-sonnet-5-5' },
      // The author shown on the writer's feedback and tracked changes.
      user: { name: WRITER },
      defaultSaveDirectory: essays,
      projects: [
        { id: uuid(1), name: 'Essays', path: essays, createdAt: '2025-01-01T00:00:00.000Z', lastOpenedAt: '2025-06-01T00:00:00.000Z' },
        { id: uuid(2), name: 'Field Notes', path: notes, createdAt: '2025-01-01T00:00:00.000Z', lastOpenedAt: '2025-05-01T00:00:00.000Z' },
      ],
      // Favorites are individual documents you return to (not projects).
      favorites: [
        { id: uuid(3), name: HERO_NAME, path: join(essays, HERO_NAME), isDirectory: false, addedAt: '2025-01-01T00:00:00.000Z' },
        { id: uuid(5), name: LEVERAGE_NAME, path: join(essays, LEVERAGE_NAME), isDirectory: false, addedAt: '2025-02-01T00:00:00.000Z' },
      ],
    })

  app = await electron.launch({
    // 2x whatever the display, so the 1280 × 800 window captures at 2560 × 1600.
    args: [join(REPO, 'out/main/index.js'), '--force-device-scale-factor=2'],
    env: { ...(process.env as Record<string, string>), PROSE_USER_DATA_DIR: profile },
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await waitForAppReady(page)
  await dismissOnboarding(page)
  await dismissOverlay(page)

  // Key every provider, then reload so the settings store reads the status.
  const saved = await page.evaluate(async (keys) => {
    const results: boolean[] = []
    for (const [provider, key] of keys) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results.push((await (window as any).api.setLlmKey({ provider, key })).ok)
    }
    return results
  }, DEMO_KEYS)
  expect(saved).toEqual([true, true, true])
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await waitForAppReady(page)
  await dismissOverlay(page)

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setContentSize(1280, 800)
    w.center()
  })
  await drawWindowButtons(page)
  await page.waitForTimeout(500)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(docsDir, { recursive: true, force: true })
  rmSync(profile, { recursive: true, force: true })
})

test('01 hero — editor (light)', async () => {
  await setMode('light')
  await openHero()
  await selectView('projects')
  await scrollTop()
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(SHOTS, '01-hero-editor.png') })
})

test('03 any model — the model menu (light)', async () => {
  await setMode('light')
  await openHero()
  await closeChat()
  await setFilesVisible(false)
  await scrollTop()
  await page.locator('[data-testid="status-model"]').click()
  await expect(page.getByRole('menu')).toBeVisible()
  // The menu scrolls past 300 px in the app. The shot lifts that cap so all
  // three providers are in frame: the same items, drawn taller than shipped.
  await page.getByRole('menu').evaluate((menu) => {
    ;(menu as HTMLElement).style.maxHeight = 'none'
  })
  // Off the trigger, so its tooltip isn't in the shot.
  await page.mouse.move(400, 300)
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(SHOTS, '03-any-model.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
})

test('04 suggesting mode (dark)', async () => {
  await setMode('dark')
  await openHero()
  await closeChat()
  await setFilesVisible(false)
  await clearSuggestions()
  const toggle = page.locator('[data-testid="status-suggesting"]')
  await toggle.click()
  await expect(toggle).toHaveText('Suggesting')
  // A replacement, a deletion and an insertion in one paragraph, last first.
  await selectText('darlings')
  await page.keyboard.type('favorites')
  await selectText(' from last year')
  await page.keyboard.press('Backspace')
  await selectText('leaked', true)
  await page.keyboard.type('infamous ')
  await expect(page.locator('[data-testid="status-suggestions"]')).toBeVisible()
  await scrollTop()
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(SHOTS, '04-suggesting.png') })
  // Leave the shared tab as the next scene expects it.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__prose_editor.commands.rejectAllTrackedChanges()
  })
  await toggle.click()
  await expect(toggle).toHaveText('Editing')
})

test('05 review every suggestion (light)', async () => {
  await setMode('light')
  await openHero()
  await closeChat()
  await setFilesVisible(false)
  await clearSuggestions()
  await seedCopyedits()
  // Open Quick Review via the status-bar suggestion chip.
  await page.getByRole('button', { name: /\d+ suggestion/ }).first().click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(SHOTS, '05-review-diffs.png') })
  const closeReview = page.locator('[aria-label^="Close review"]')
  if (await closeReview.isVisible({ timeout: 1_000 }).catch(() => false)) await closeReview.click()
  await page.waitForTimeout(400)
})

test('06 who did what — activity (dark)', async () => {
  await setMode('dark')
  await openHero()
  await setFilesVisible(false)
  await clearSuggestions()
  const ids = await seedCopyedits()
  // A second model, so the panel shows authors from two providers.
  ids.push(await suggest('dredded', (s) => s.replace('dredded', 'dreaded'), 'Typo.', 'gpt-5.5'))
  // The writer's feedback on the newest suggestion (the top card), before accepting it.
  await page.evaluate((id) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__prose_editor.commands.setAISuggestionReply(id, 'Good catch.')
  }, ids[ids.length - 1])
  for (const id of ids) {
    await executeProseTool(page, 'accept_diff', { id })
    await page.waitForTimeout(150)
  }
  // Open chat, switch to the Activity tab.
  const showChat = page.locator('[aria-label="Show chat"]')
  if (await showChat.isVisible({ timeout: 1_000 }).catch(() => false)) await showChat.click()
  await page.getByRole('tab', { name: /Activity/ }).click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(SHOTS, '06-who-did-what.png') })
})

test('07 projects & favorites (light)', async () => {
  await setMode('light')
  await openHero()
  await closeChat()
  await selectView('favorites')
  await scrollTop()
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(SHOTS, '07-projects-favorites.png') })
})
