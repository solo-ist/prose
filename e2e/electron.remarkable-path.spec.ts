/**
 * Unit tests for the reMarkable path helpers (`src/renderer/lib/remarkablePath.ts`)
 * that drive read-only derivation for synced reMarkable documents.
 *
 * Pure-Node test (the `electron.` prefix only satisfies playwright.config's
 * testMatch glob); the helpers have no store/DOM dependencies.
 */
import { test, expect } from '@playwright/test'
import { isRemarkableOcrPath, remarkableNotebookIdFromPath } from '../src/renderer/lib/remarkablePath'

const OCR = '/Users/x/Documents/reMarkable/.remarkable/55764e52-ff2e-4172-a470-2d7d38037985/Zero Token Architecture.md'

test('isRemarkableOcrPath: true only for hidden .remarkable markdown', () => {
  expect(isRemarkableOcrPath(OCR)).toBe(true)
  // A user's editable copy lives in the visible sync folder, not .remarkable/
  expect(isRemarkableOcrPath('/Users/x/Documents/reMarkable/Writing/Zero Token Architecture.md')).toBe(false)
  expect(isRemarkableOcrPath('/Users/x/Documents/notes/todo.md')).toBe(false)
  // Non-markdown files inside .remarkable/ are not OCR documents
  expect(isRemarkableOcrPath('/Users/x/Documents/reMarkable/.remarkable/abc/page.rm')).toBe(false)
  expect(isRemarkableOcrPath(null)).toBe(false)
  expect(isRemarkableOcrPath(undefined)).toBe(false)
  expect(isRemarkableOcrPath('')).toBe(false)
})

test('remarkableNotebookIdFromPath: extracts the id segment after .remarkable/', () => {
  expect(remarkableNotebookIdFromPath(OCR)).toBe('55764e52-ff2e-4172-a470-2d7d38037985')
  expect(remarkableNotebookIdFromPath('/x/Documents/reMarkable/Writing/note.md')).toBeNull()
  expect(remarkableNotebookIdFromPath(null)).toBeNull()
})
