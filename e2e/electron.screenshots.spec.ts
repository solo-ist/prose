/**
 * Marketing screenshot generator (temporary — not part of the test suite).
 * Run: npx playwright test electron.screenshots --workers=1
 *
 * Isolated, seeded instance (Prose theme) → README hero + App Store scenes
 * 1, 3, 4, 5. Scene 2 (live AI dialogue) runs against the real profile in a
 * separate spec. Light hero, then alternating dark/light.
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
} from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')
const FIXTURE = join(REPO, 'e2e/fixtures/a-chorus-of-human-voices.md')
const HERO_NAME = 'A Chorus of Human Voices.md'
const LEVERAGE_NAME = 'The Great Leverage Inversion.md'
const SHOTS = '/tmp/prose-shots'

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
async function suggest(marker: string, replace: (s: string) => string, comment: string): Promise<string> {
  const node = await nodeIncluding(marker)
  const res = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ nodeId, content, search, comment }: any) =>
      (window as any).__prose_tools.executeTool(
        'suggest_edit',
        { nodeId, content, search, comment },
        'create',
        { model: 'claude-sonnet-4-6' },
      ),
    { nodeId: node.id, content: replace(node.content ?? ''), search: node.content, comment },
  )
  expect((res as { success: boolean }).success).toBe(true)
  return (res as { data: { suggestionId: string } }).data.suggestionId
}

async function setMode(mode: 'light' | 'dark'): Promise<void> {
  await page.evaluate((m) => document.documentElement.classList.toggle('dark', m === 'dark'), mode)
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
    const more = page.locator('[aria-label="More views"]')
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

  writeFileSync(
    join(profile, 'settings.json'),
    JSON.stringify({
      appearance: { color: 'prose', mode: 'light', icon: 'pilcrow', migrationToastShown: true },
      aiConsent: { consented: true, consentedAt: '2025-01-01T00:00:00.000Z' },
      llm: { provider: 'anthropic', apiKey: 'sk-ant-demo-screenshot-key', model: 'claude-sonnet-4-6' },
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

test('03 review every suggestion (light)', async () => {
  await setMode('light')
  await openHero()
  await closeChat()
  await setFilesVisible(false)
  await clearSuggestions()
  await seedCopyedits()
  // Open Quick Review via the status-bar suggestion chip.
  await page.getByRole('button', { name: /\d+ suggestion/ }).first().click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(SHOTS, '03-review-diffs.png') })
  const closeReview = page.locator('[aria-label^="Close review"]')
  if (await closeReview.isVisible({ timeout: 1_000 }).catch(() => false)) await closeReview.click()
  await page.waitForTimeout(400)
})

test('04 edits history — activity (dark)', async () => {
  await setMode('dark')
  await openHero()
  await setFilesVisible(false)
  await clearSuggestions()
  const ids = await seedCopyedits()
  ids.push(await suggest('dredded', (s) => s.replace('dredded', 'dreaded'), 'Typo.'))
  for (const id of ids) {
    await executeProseTool(page, 'accept_diff', { id })
    await page.waitForTimeout(150)
  }
  // Open chat, switch to the Activity tab.
  const showChat = page.locator('[aria-label="Show chat"]')
  if (await showChat.isVisible({ timeout: 1_000 }).catch(() => false)) await showChat.click()
  await page.getByRole('button', { name: /Activity/ }).click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(SHOTS, '04-edits-history.png') })
})

test('05 projects & favorites (light)', async () => {
  await setMode('light')
  await openHero()
  await closeChat()
  await selectView('favorites')
  await scrollTop()
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(SHOTS, '05-projects-favorites.png') })
})
