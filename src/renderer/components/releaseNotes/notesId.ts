/**
 * Which bundled notes files a build reads after an update, in order (#1222).
 *
 * The App Store edition reads `<version>-mas.md` first: the direct-download notes name
 * surfaces it does not have (sharing, Claude Desktop, the MCP update prompt), and App
 * Store users arrive from whatever version the store last carried. A version with no
 * App Store file falls back to the shared one, which is fine as long as that file names
 * nothing direct-only; `notesFiles.test.ts` enforces it.
 *
 * The main process reads `resources/release-notes/<id>.md` and its id check already
 * allows a `-suffix`, so no main-process change is needed. `release.yml` publishes only
 * `<version>.md` as the GitHub release body.
 */
export const MAS_NOTES_SUFFIX = '-mas'

export function releaseNotesIds(version: string, isMas: boolean): string[] {
  return isMas ? [`${version}${MAS_NOTES_SUFFIX}`, version] : [version]
}
