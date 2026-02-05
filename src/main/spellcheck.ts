import { BrowserWindow, Menu, MenuItem, session } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DICTIONARY_PATH = join(homedir(), '.prose', 'dictionary.json')

/**
 * Load personal dictionary words from ~/.prose/dictionary.json
 */
export async function loadPersonalDictionary(): Promise<string[]> {
  try {
    const content = await fs.readFile(DICTIONARY_PATH, 'utf-8')
    const data = JSON.parse(content)
    return Array.isArray(data.words) ? data.words : []
  } catch {
    // File doesn't exist or is invalid - return empty array
    return []
  }
}

/**
 * Save personal dictionary words to ~/.prose/dictionary.json
 */
export async function savePersonalDictionary(words: string[]): Promise<void> {
  const dir = join(homedir(), '.prose')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(DICTIONARY_PATH, JSON.stringify({ words }, null, 2))
}

/**
 * Add a word to the personal dictionary and register with spellchecker
 */
export async function addToDictionary(word: string): Promise<void> {
  const words = await loadPersonalDictionary()
  if (!words.includes(word.toLowerCase())) {
    words.push(word.toLowerCase())
    await savePersonalDictionary(words)
  }
  // Register with Electron's spellchecker
  session.defaultSession.addWordToSpellCheckerDictionary(word)
}

/**
 * Initialize spellcheck by loading personal dictionary words
 */
export async function initializeSpellcheck(): Promise<void> {
  const words = await loadPersonalDictionary()
  for (const word of words) {
    session.defaultSession.addWordToSpellCheckerDictionary(word)
  }
  console.log(`[Spellcheck] Loaded ${words.length} personal dictionary words`)
}

/**
 * Set up context menu for spellcheck suggestions and standard edit operations
 */
export function setupContextMenu(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('context-menu', (event, params) => {
    const menu = new Menu()

    // If there's a misspelled word, show spelling suggestions
    if (params.misspelledWord) {
      // Add spelling suggestions (up to 5)
      const suggestions = params.dictionarySuggestions.slice(0, 5)

      if (suggestions.length > 0) {
        for (const suggestion of suggestions) {
          menu.append(
            new MenuItem({
              label: suggestion,
              click: () => {
                mainWindow.webContents.replaceMisspelling(suggestion)
              }
            })
          )
        }
      } else {
        menu.append(
          new MenuItem({
            label: 'No suggestions',
            enabled: false
          })
        )
      }

      menu.append(new MenuItem({ type: 'separator' }))

      // Add to dictionary option
      menu.append(
        new MenuItem({
          label: 'Add to Dictionary',
          click: async () => {
            await addToDictionary(params.misspelledWord)
          }
        })
      )

      menu.append(new MenuItem({ type: 'separator' }))
    }

    // Standard edit operations for editable areas
    if (params.isEditable) {
      menu.append(
        new MenuItem({
          label: 'Cut',
          role: 'cut',
          enabled: params.editFlags.canCut
        })
      )
      menu.append(
        new MenuItem({
          label: 'Copy',
          role: 'copy',
          enabled: params.editFlags.canCopy
        })
      )
      menu.append(
        new MenuItem({
          label: 'Paste',
          role: 'paste',
          enabled: params.editFlags.canPaste
        })
      )
      menu.append(
        new MenuItem({
          label: 'Select All',
          role: 'selectAll',
          enabled: params.editFlags.canSelectAll
        })
      )
    } else if (params.selectionText) {
      // Non-editable area with selected text - only show Copy
      menu.append(
        new MenuItem({
          label: 'Copy',
          role: 'copy'
        })
      )
    }

    // Only show menu if there are items
    if (menu.items.length > 0) {
      menu.popup()
    }
  })
}
