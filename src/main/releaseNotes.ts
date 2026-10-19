import { readFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'

export interface ReleaseNotes {
  version: string
  markdown: string
}

/**
 * Where the per-version notes live. `resources/` is already shipped wholesale by
 * electron-builder's `extraResources` (`from: resources/` → `to: resources/`), so
 * adding a file under `resources/release-notes/` needs no packaging change.
 */
function notesPathFor(version: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'release-notes', `${version}.md`)
    : join(__dirname, '../../resources/release-notes', `${version}.md`)
}

/**
 * Read the notes for a version, or null when there are none.
 *
 * A missing file is a normal outcome, not an error: a build whose notes were never
 * written (a local build, a hotfix tag) must still launch, and the caller suppresses
 * the modal rather than showing an empty one. Read from disk rather than the network
 * so it works offline and immediately after restart.
 */
export async function readReleaseNotes(version: string): Promise<ReleaseNotes | null> {
  // Guard the path segment: the version reaches us from buildInfo, but it ends up in
  // a filesystem path, so refuse anything that is not a plain semver-ish token.
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/.test(version)) {
    console.warn(`[releaseNotes] refusing a malformed version: ${version}`)
    return null
  }

  const path = notesPathFor(version)
  try {
    const markdown = await readFile(path, 'utf8')
    if (!markdown.trim()) return null
    return { version, markdown }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn(`[releaseNotes] could not read ${path}: ${String(err)}`)
    }
    return null
  }
}
