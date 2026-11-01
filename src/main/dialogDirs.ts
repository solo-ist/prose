/**
 * Last-used directories for the native file dialogs (#1153).
 *
 * Electron 43 changed `dialog.showOpenDialog` / `showSaveDialog`: when the
 * caller passes no `defaultPath`, the dialog opens in Downloads and the OS no
 * longer remembers the last directory between invocations. Before that, macOS
 * remembered per app. Prose passed a bare filename or nothing, so after the
 * Electron 45 bump every Open and Save As started in Downloads.
 *
 * This module restores the old behaviour the way Electron's breaking-change
 * note suggests: remember the directory the user last chose, per dialog kind,
 * and pass it back as `defaultPath`. The memory is written to `dialog-dirs.json`
 * in the profile so it survives a relaunch, as the OS memory did. First run
 * falls back to the default save directory from settings, then Documents.
 *
 * Path source: the remembered directories come from dialog results (A) and
 * are only ever handed back to the OS dialog as a starting point; nothing here
 * reads or writes a user file.
 */
import { app } from 'electron'
import { readFile, writeFile, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { expandPath, getSettingsDir } from './paths'

/** `open` = file open; `save` = Save As and the exports; `folder` = folder pickers. */
export type DialogKind = 'open' | 'save' | 'folder'

type DialogDirs = Partial<Record<DialogKind, string>>

const FILE_NAME = 'dialog-dirs.json'
let cache: DialogDirs | null = null

function storePath(): string {
  return join(getSettingsDir(), FILE_NAME)
}

async function load(): Promise<DialogDirs> {
  if (cache) return cache
  try {
    const parsed = JSON.parse(await readFile(storePath(), 'utf-8')) as unknown
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as DialogDirs) : {}
  } catch {
    cache = {}
  }
  return cache
}

async function isDirectory(path: string | undefined): Promise<boolean> {
  if (!path) return false
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function defaultSaveDirectory(): Promise<string | undefined> {
  try {
    const raw = await readFile(join(getSettingsDir(), 'settings.json'), 'utf-8')
    const value = (JSON.parse(raw) as { defaultSaveDirectory?: unknown }).defaultSaveDirectory
    return typeof value === 'string' && value ? expandPath(value) : undefined
  } catch {
    return undefined
  }
}

/**
 * The `defaultPath` for a dialog of this kind: the directory the user last
 * chose for it, else the default save directory, else Documents, else home;
 * joined with `filename` when a save dialog proposes one.
 */
export async function dialogDefaultPath(kind: DialogKind, filename?: string): Promise<string> {
  const remembered = (await load())[kind]
  const candidates = [remembered, await defaultSaveDirectory(), app.getPath('documents')]
  let dir = app.getPath('home')
  for (const candidate of candidates) {
    if (await isDirectory(candidate)) {
      dir = candidate as string
      break
    }
  }
  return filename ? join(dir, filename) : dir
}

/**
 * Remember where the user ended up. `chosen` is the dialog's result: a file
 * for open and save dialogs (its directory is kept), a directory for folder
 * pickers. A write failure is logged, never thrown: a dialog that worked must
 * not fail because its memory could not be saved.
 */
export async function rememberDialogDir(
  kind: DialogKind,
  chosen: string,
  chosenIs: 'file' | 'directory',
): Promise<void> {
  const dir = chosenIs === 'file' ? dirname(chosen) : chosen
  const dirs = await load()
  if (dirs[kind] === dir) return
  dirs[kind] = dir
  try {
    await writeFile(storePath(), JSON.stringify(dirs, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[dialogDirs] Could not persist the last-used directory:', err)
  }
}
