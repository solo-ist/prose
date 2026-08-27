/**
 * Focused coverage for the local human Suggesting mode.
 *
 * These tests deliberately cover the basic one-human/one-agent workflow only:
 * plain inline typing, correction, deletion, replacement, and the shared
 * suggestion lifecycle. Rich-text and structural edits remain direct edits.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  waitForAppReady,
  dismissOnboarding,
  dismissOverlay,
  waitForEditor,
  executeProseTool,
  selectors,
  setEditorContent,
} from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string
let activityDocsDir: string

interface ListedSuggestion {
  id: string
  type: 'edit' | 'insertion' | 'deletion'
  originalText: string
  suggestedText: string
  status: 'pending' | 'accepted' | 'rejected' | 'superseded'
  attribution: {
    actor: 'human' | 'assistant' | 'system'
    origin: 'ui' | 'chat' | 'mcp'
  }
}

async function setSuggesting(testPage: Page, enabled: boolean): Promise<void> {
  const toggle = testPage.getByTestId('human-suggestion-toggle')
  await toggle.waitFor({ state: 'visible' })
  const pressed = await toggle.getAttribute('aria-pressed') === 'true'
  if (pressed !== enabled) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', String(enabled))
}

async function listSuggestions(
  testPage: Page,
  status: ListedSuggestion['status'] | 'all' = 'pending',
): Promise<ListedSuggestion[]> {
  const result = await executeProseTool(testPage, 'list_suggestions', { status })
  expect(result.success, JSON.stringify(result)).toBe(true)
  return (result.data as { suggestions: ListedSuggestion[] }).suggestions
}

async function pendingSuggestion(testPage: Page): Promise<ListedSuggestion> {
  await expect.poll(async () => (await listSuggestions(testPage)).length).toBe(1)
  await expect.poll(async () => (await listSuggestions(testPage))[0]?.attribution.actor).toBe('human')
  return (await listSuggestions(testPage))[0]
}

async function decideSuggestion(
  testPage: Page,
  id: string,
  decision: 'accept' | 'reject',
): Promise<boolean> {
  return testPage.evaluate(
    ({ suggestionId, suggestionDecision }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__prose_editor
      return suggestionDecision === 'accept'
        ? editor.commands.acceptAISuggestion(suggestionId)
        : editor.commands.rejectAISuggestion(suggestionId)
    },
    { suggestionId: id, suggestionDecision: decision },
  )
}

async function editorSnapshot(testPage: Page): Promise<{
  text: string
  marks: Array<{ id: string; type: string; humanInline: boolean }>
}> {
  return testPage.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    const marks: Array<{ id: string; type: string; humanInline: boolean }> = []
    editor.state.doc.descendants((node: {
      marks: Array<{ type: { name: string }; attrs: Record<string, unknown> }>
    }) => {
      for (const mark of node.marks) {
        if (mark.type.name !== 'aiSuggestion') continue
        marks.push({
          id: String(mark.attrs.id),
          type: String(mark.attrs.type),
          humanInline: mark.attrs.humanInline === true,
        })
      }
    })
    return { text: editor.state.doc.textContent as string, marks }
  })
}

async function ensureActivityVisible(testPage: Page): Promise<void> {
  const activityTab = testPage.getByRole('tab', { name: /Activity/ })
  if (!await activityTab.isVisible({ timeout: 500 }).catch(() => false)) {
    await testPage.keyboard.press('ControlOrMeta+Shift+L')
    await activityTab.waitFor({ state: 'visible', timeout: 5_000 })
  }
  await activityTab.click()
}

async function addHumanComment(
  testPage: Page,
  selection: { from: number; to: number },
  text: string,
): Promise<void> {
  // A newly-mounted document schedules one-time editor autofocus. Let that
  // settle before applying the selection used by the comment popover.
  await testPage.waitForTimeout(100)
  await testPage.evaluate(({ from, to }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    editor.chain().focus().setTextSelection({ from, to }).run()
  }, selection)
  const addCommentButton = testPage.getByTitle('Add comment (Cmd+Shift+A)')
  await expect(addCommentButton).toBeVisible()
  await addCommentButton.click({ force: true })
  const dialog = testPage.getByRole('dialog', { name: 'Add Comment' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder(/Enter your instruction/).fill(text)
  await dialog.getByPlaceholder(/Enter your instruction/).press('ControlOrMeta+Enter')
  await expect(dialog).not.toBeVisible()
}

test.beforeAll(async () => {
  test.setTimeout(60_000)
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-human-suggestions-'))
  activityDocsDir = mkdtempSync(join(tmpdir(), 'prose-human-suggestions-docs-'))
  const launched = await launchApp({
    env: {
      PROSE_USER_DATA_DIR: userDataDir,
      PROSE_REMOTE_DEBUGGING_PORT: '0',
    },
  })
  app = launched.app
  page = launched.page

  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})

  const newDocument = page.getByRole('button', { name: 'New Document' })
  if (await newDocument.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await newDocument.click({ force: true })
  }
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(activityDocsDir, { recursive: true, force: true })
})

test.beforeEach(async () => {
  await setEditorContent(page, '<p></p>')
  await setSuggesting(page, true)
})

test('typed text becomes one attributed insertion that can be accepted', async () => {
  await page.locator(selectors.editor).click()
  await page.keyboard.type('hello')

  const suggestion = await pendingSuggestion(page)
  expect(suggestion).toMatchObject({
    type: 'insertion',
    originalText: '',
    suggestedText: 'hello',
    attribution: { actor: 'human', origin: 'ui' },
  })
  const pending = await editorSnapshot(page)
  expect(pending.text).toBe('hello')
  expect(pending.marks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: suggestion.id, type: 'insertion', humanInline: true }),
  ]))

  const reviewButton = page.getByRole('button', { name: /1 suggestion/ }).first()
  await reviewButton.click()
  const reviewPanel = page.getByRole('heading', { name: 'Quick Review' }).locator('xpath=../../..')
  await expect(reviewPanel.getByTestId('suggestion-attribution')).toHaveText('You')
  await expect(reviewPanel).not.toContainText('Human change')
  await expect(reviewPanel.getByText('Explanation:', { exact: true })).toHaveCount(0)
  await reviewPanel.getByRole('button', { name: /Close review/ }).click()

  expect(await decideSuggestion(page, suggestion.id, 'accept')).toBe(true)
  const accepted = await editorSnapshot(page)
  expect(accepted.text).toBe('hello')
  expect(accepted.marks).toHaveLength(0)

  const history = await listSuggestions(page, 'accepted')
  expect(history).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: suggestion.id,
      status: 'accepted',
      attribution: { actor: 'human', origin: 'ui' },
    }),
  ]))
})

test('backspace edits the current human insertion instead of nesting a deletion', async () => {
  await page.locator(selectors.editor).click()
  await page.keyboard.type('abc')
  await page.keyboard.press('Backspace')

  const suggestion = await pendingSuggestion(page)
  expect(suggestion).toMatchObject({
    type: 'insertion',
    originalText: '',
    suggestedText: 'ab',
  })
  expect((await editorSnapshot(page)).text).toBe('ab')

  expect(await decideSuggestion(page, suggestion.id, 'reject')).toBe(true)
  expect((await editorSnapshot(page)).text).toBe('')
})

test('replacement and deletion reuse the shared review commands', async () => {
  await setEditorContent(page, '<p>alpha beta</p>')
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    editor.chain().focus().setTextSelection({ from: 7, to: 11 }).run()
  })
  // The toolbar toggle retains DOM focus; explicitly return focus to the
  // editor before sending the replacement keystrokes.
  await page.locator(selectors.editor).focus()
  await page.keyboard.type('gamma')

  const replacement = await pendingSuggestion(page)
  expect(replacement).toMatchObject({
    type: 'edit',
    originalText: 'beta',
    suggestedText: 'gamma',
    attribution: { actor: 'human', origin: 'ui' },
  })
  expect((await editorSnapshot(page)).text).toBe('alpha beta')

  expect(await decideSuggestion(page, replacement.id, 'accept')).toBe(true)
  expect((await editorSnapshot(page)).text).toBe('alpha gamma')

  await setEditorContent(page, '<p>abc</p>')
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    editor.chain().focus().setTextSelection(4).run()
  })
  await page.keyboard.press('Backspace')

  const deletion = await pendingSuggestion(page)
  expect(deletion).toMatchObject({
    type: 'deletion',
    originalText: 'c',
    suggestedText: '',
  })
  expect((await editorSnapshot(page)).text).toBe('abc')

  expect(await decideSuggestion(page, deletion.id, 'accept')).toBe(true)
  expect((await editorSnapshot(page)).text).toBe('ab')
})

test('an agent can revise a human insertion and preserve the review lifecycle', async () => {
  await page.locator(selectors.editor).click()
  await page.keyboard.type('hello')

  const human = await pendingSuggestion(page)
  const revised = await executeProseTool(page, 'revise_suggestion', {
    id: human.id,
    content: 'hullo',
    comment: 'Agent revision',
  })
  expect(revised.success, JSON.stringify(revised)).toBe(true)
  const revisedId = (revised.data as { suggestionId: string }).suggestionId

  await expect.poll(async () => (await listSuggestions(page)).length).toBe(1)
  const pending = (await listSuggestions(page))[0]
  expect(pending).toMatchObject({
    id: revisedId,
    type: 'insertion',
    originalText: '',
    suggestedText: 'hullo',
    attribution: { actor: 'assistant', origin: 'chat' },
  })

  const snapshot = await editorSnapshot(page)
  expect(snapshot.text).toBe('hullo')
  expect(snapshot.marks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: revisedId, type: 'insertion', humanInline: true }),
  ]))

  const superseded = await listSuggestions(page, 'superseded')
  expect(superseded).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: human.id, status: 'superseded' }),
  ]))

  expect(await decideSuggestion(page, revisedId, 'reject')).toBe(true)
  expect((await editorSnapshot(page)).text).toBe('')
})

test('commenting beside Quick Review keeps the suggestion pending and updates Activity', async () => {
  await setEditorContent(page, '<p>alpha beta</p>')
  await page.locator(selectors.editor).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' hello')

  const suggestion = await pendingSuggestion(page)
  const chatTab = page.getByRole('tab', { name: 'Chat' })
  if (!await chatTab.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press('ControlOrMeta+Shift+L')
    await chatTab.waitFor({ state: 'visible', timeout: 5_000 })
  }
  await page.getByRole('button', { name: /1 suggestion/ }).first().click()
  const reviewPanel = page.getByRole('heading', { name: 'Quick Review' }).locator('xpath=../../..')
  await expect(reviewPanel).toBeVisible()
  await expect(reviewPanel.getByTestId('suggestion-attribution')).toHaveText('You')

  // Open the real Add Comment dialog while Quick Review is still mounted.
  // This is the interaction that previously let the review window shortcut
  // consume Enter from a comment field and accept the suggestion underneath.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run()
  })
  const addCommentButton = page.getByTitle('Add comment (Cmd+Shift+A)')
  await expect(addCommentButton).toBeVisible()
  await addCommentButton.click({ force: true })
  const dialog = page.getByRole('dialog', { name: 'Add Comment' })
  await expect(dialog).toBeVisible()
  const commentText = 'Please check this sentence.'
  const commentBox = dialog.getByPlaceholder(/Enter your instruction/)
  await commentBox.fill(commentText)
  await commentBox.press('ControlOrMeta+Enter')
  await expect(dialog).not.toBeVisible()

  // After the dialog closes focus returns to the editor. Enter is a normal
  // editor key there, even while Quick Review is mounted; it must not trigger
  // the panel's global accept shortcut.
  await page.locator(selectors.editor).dispatchEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  })
  await page.waitForTimeout(300)

  // The comment submit must not dispatch Quick Review's accept command.
  await expect.poll(async () => (await listSuggestions(page, 'pending'))
    .filter((entry) => entry.id === suggestion.id).length).toBe(1)
  const suggestionEvents = await executeProseTool(page, 'list_review_events', { targetType: 'suggestion' })
  expect(suggestionEvents.success, JSON.stringify(suggestionEvents)).toBe(true)
  expect((suggestionEvents.data as { events: Array<{ targetId: string; eventType: string }> }).events)
    .not.toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: suggestion.id, eventType: 'suggestion_decided' }),
    ]))

  // Activity is driven by the live comment store. Waiting for the row here
  // also covers the load-vs-create race that previously hid a freshly-added
  // thread after the persisted comment_created event had already been written.
  await reviewPanel.getByRole('button', { name: /Close review/ }).click()
  await page.getByRole('tab', { name: /Activity/ }).click()
  await expect(page.getByText(commentText, { exact: true })).toBeVisible()
})

test('mounted Activity updates with UI suggestion feedback while the suggestion stays pending', async () => {
  await page.locator(selectors.editor).click()
  await page.keyboard.type('hello')

  const suggestion = await pendingSuggestion(page)
  await ensureActivityVisible(page)
  const activityCard = page.getByTestId(`suggestion-activity-${suggestion.id}`)
  await expect(activityCard).toBeVisible()

  // Submit feedback through the editor's suggestion popover while Activity is
  // already mounted. The Activity card should consume the same live history
  // update without requiring a tab switch, reload, or another review load.
  await page.locator('.ai-suggestion-mark').first().click()
  const popover = page.locator('.ai-suggestion-popover')
  await expect(popover).toBeVisible()
  await popover.getByRole('button', { name: 'Feedback' }).click()
  const feedbackText = 'Please keep this concise.'
  await popover.locator('textarea').fill(feedbackText)
  await popover.getByRole('button', { name: 'Submit' }).click()
  await expect(popover).toHaveCount(0)

  await expect(activityCard).toContainText('Your feedback')
  await expect(activityCard).toContainText(feedbackText)
  await expect.poll(async () => (await listSuggestions(page, 'pending'))
    .filter((entry) => entry.id === suggestion.id).length).toBe(1)
})

test('Activity opens Quick Review on the clicked non-first suggestion', async () => {
  const path = join(activityDocsDir, 'activity-navigation.md')
  writeFileSync(path, 'one two three four five six\n')
  const opened = await executeProseTool(page, 'open_file', { path })
  expect(opened.success, JSON.stringify(opened)).toBe(true)
  await waitForEditor(page)
  await setSuggesting(page, true)
  await setEditorContent(page, '<p>one two three four five six</p>')

  // Create the sixth document suggestion first so it is the oldest Activity
  // card, then add the preceding five. Activity is newest-first while
  // Quick Review follows document order; the clicked card should therefore
  // open at 6/6, not the default 1/6.
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    const words = ['one', 'two', 'three', 'four', 'five', 'six']
    const positions = words.map((word, index) => {
      const from = 1 + words.slice(0, index).reduce((total, previous) => total + previous.length + 1, 0)
      return { word, from, to: from + word.length }
    })
    for (const index of [5, 0, 1, 2, 3, 4]) {
      const position = positions[index]
      editor.commands.setTextSelection({ from: position.from, to: position.to })
      editor.commands.setAISuggestion({
        id: `activity-navigation-${index}`,
        type: 'edit',
        originalText: position.word,
        suggestedText: `${position.word}-suggested`,
        explanation: '',
        provenanceModel: 'Navigation test',
        provenanceSource: 'mcp',
      })
      await new Promise((resolve) => setTimeout(resolve, 8))
    }
  })

  await expect.poll(async () => (await listSuggestions(page)).length).toBe(6)
  await ensureActivityVisible(page)
  const cards = page.locator('[data-testid^="suggestion-activity-"]')
  await expect(cards).toHaveCount(6)
  const targetId = 'suggestion-activity-activity-navigation-5'
  const cardIds = await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')))
  expect(cardIds.indexOf(targetId)).toBeGreaterThan(0)

  const targetCard = page.getByTestId(targetId)
  await expect(targetCard).toContainText('six-suggested')
  await targetCard.click()

  const reviewPanel = page.getByRole('heading', { name: 'Quick Review' }).locator('xpath=../../..')
  await expect(reviewPanel).toBeVisible()
  await expect(reviewPanel).toContainText('six-suggested')
  await expect(reviewPanel.getByText('6/6', { exact: true })).toBeVisible()
  await expect.poll(async () => (await listSuggestions(page)).length).toBe(6)
})

test('Activity follows the active document and updates for a human comment', async () => {
  const firstComment = 'First document comment.'
  const secondComment = 'Second document comment.'
  const firstPath = join(activityDocsDir, 'activity-first.md')
  const secondPath = join(activityDocsDir, 'activity-second.md')
  writeFileSync(firstPath, 'First document text.\n')
  writeFileSync(secondPath, 'Second document text.\n')

  const openedFirst = await executeProseTool(page, 'open_file', { path: firstPath })
  expect(openedFirst.success, JSON.stringify(openedFirst)).toBe(true)
  await waitForEditor(page)
  await setSuggesting(page, true)

  await page.locator(selectors.editor).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' pending')
  const firstSuggestion = await pendingSuggestion(page)
  await addHumanComment(page, { from: 1, to: 6 }, firstComment)
  await expect.poll(async () => (await listSuggestions(page, 'pending'))
    .filter((entry) => entry.id === firstSuggestion.id).length).toBe(1)

  const tabsAfterFirst = await executeProseTool(page, 'list_tabs', {})
  expect(tabsAfterFirst.success, JSON.stringify(tabsAfterFirst)).toBe(true)
  const firstTab = (tabsAfterFirst.data as { tabs: Array<{ tabId: string; isActive: boolean }> }).tabs
    .find((tab) => tab.isActive)
  expect(firstTab).toBeTruthy()

  await ensureActivityVisible(page)
  await expect(page.getByText(firstComment, { exact: true })).toBeVisible()

  // Allow the comment and the debounced human suggestion snapshot to reach
  // persistence before opening the second document.
  await page.waitForTimeout(700)
  const openedSecond = await executeProseTool(page, 'open_file', { path: secondPath })
  expect(openedSecond.success, JSON.stringify(openedSecond)).toBe(true)
  await waitForEditor(page)
  await setSuggesting(page, true)

  // The Activity panel remains mounted while the active document changes. A
  // previous tab's thread must disappear before the new human comment arrives.
  await expect(page.getByText(firstComment, { exact: true })).toHaveCount(0)

  await page.locator(selectors.editor).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' pending')
  const secondSuggestion = await pendingSuggestion(page)

  // A duplicate same-path tab can leave a late comment load in flight. It
  // must not repoint the live store while Activity is already mounted; the
  // next UI-created comment must remain visible for the active document.
  const activeCommentDocId = await page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__prose_tools.getCommentDocId() as string | null
  )
  expect(activeCommentDocId).toBeTruthy()
  await page.evaluate(async (staleDocumentId) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__prose_tools.loadCommentsForTesting(staleDocumentId)
  }, 'inactive-duplicate-tab-document')
  await expect.poll(async () => page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__prose_tools.getCommentDocId() as string | null
  )).toBe(activeCommentDocId)

  await addHumanComment(page, { from: 1, to: 7 }, secondComment)
  await expect.poll(async () => page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__prose_tools.getCommentStore() as Array<{ comment: string }>
  ).then((comments) => comments.some((comment) => comment.comment === secondComment))).toBe(true)
  await expect.poll(async () => (await listSuggestions(page, 'pending'))
    .filter((entry) => entry.id === secondSuggestion.id).length).toBe(1)
  await expect(page.getByText(secondComment, { exact: true })).toBeVisible()

  const switchedBack = await executeProseTool(page, 'select_tab', { tabId: firstTab!.tabId })
  expect(switchedBack.success, JSON.stringify(switchedBack)).toBe(true)
  await waitForEditor(page)
  await expect(page.getByText(firstComment, { exact: true })).toBeVisible()
  await expect(page.getByText(secondComment, { exact: true })).toHaveCount(0)
  await expect.poll(async () => (await listSuggestions(page, 'pending'))
    .filter((entry) => entry.id === firstSuggestion.id).length).toBe(1)
})
