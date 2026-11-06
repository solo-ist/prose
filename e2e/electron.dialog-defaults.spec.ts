/**
 * Native dialogs remember their directory (#1153).
 *
 * Electron 43 opens every dialog that has no `defaultPath` in Downloads and
 * stops the OS from remembering the last directory. Prose used to pass none
 * (Open, the folder pickers) or a bare filename (Save As, the exports), so
 * after the Electron 45 bump every dialog started in Downloads. The fix routes
 * every `defaultPath` through `dialogDefaultPath()` and records each result
 * with `rememberDialogDir()` (src/main/dialogDirs.ts).
 *
 * Native dialogs cannot be driven from Playwright, so these are source-level
 * guards in the style of electron.icon-variants.spec.ts. The silent regression
 * they catch is a new or edited dialog call that forgets the helper, which
 * would quietly start in Downloads again.
 */

import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/** Comment lines name the calls they explain; the assertions are about code. */
function stripComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n')
}

test.describe('native dialogs remember their directory (#1153)', () => {
  const ipc = stripComments(readFileSync(join(ROOT, 'src/main/ipc.ts'), 'utf-8'))
  const dialogCalls = ipc.split(/dialog\.show(?:Open|Save)Dialog\(/).slice(1)

  test('every open and save dialog takes its defaultPath from dialogDefaultPath()', () => {
    // Open, Save As, export .txt, export .html, select folder.
    expect(dialogCalls.length).toBeGreaterThanOrEqual(5)
    for (const call of dialogCalls) {
      // The options object closes at the handler's indentation.
      const options = call.slice(0, call.indexOf('\n    })'))
      expect(options, options).toContain('await dialogDefaultPath(')
    }
  })

  test('every chosen path is remembered for the next dialog of its kind', () => {
    const remembers = ipc.split('await rememberDialogDir(').length - 1
    expect(remembers).toBe(dialogCalls.length)
  })

  test('the clipboard write is awaited (a Promise since Electron 44)', () => {
    expect(ipc).toMatch(/await clipboard\.writeText\(/)
    expect(ipc).not.toMatch(/(?<!await )clipboard\.writeText\(/)
  })
})
