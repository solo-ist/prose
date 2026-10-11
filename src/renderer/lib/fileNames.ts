/**
 * Sanitize a user-typed file or folder NAME (not a path) before it is joined
 * onto a directory the user chose (#918, path-source class C).
 *
 * The explorer builds `${dir}/${typedName}` for New File / New Folder / Rename.
 * Without this, a name like `../../escape` or `a/b` walks out of the parent
 * folder — main's normalizePath() is a normalizer, not containment, so the
 * typed segment has to be made plain here. Mirrors the character set
 * useTabs.ts uses for title-driven renames.
 *
 * Returns null when nothing usable remains (empty, `.`, `..`).
 */
export function sanitizeEntryName(raw: string): string | null {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return null
  return cleaned
}
