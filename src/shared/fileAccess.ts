/**
 * Options the renderer passes alongside a filesystem IPC path so the main
 * process can pick the right validation for the path's ORIGIN (#918).
 *
 * - no `origin` → user-chosen path (dialog, explorer entry, current tab):
 *   normalized only.
 * - `origin: 'tool'` → the path came from an LLM or MCP tool argument, which a
 *   document can steer via prompt injection: contained to text files under the
 *   home folder, outside hidden directories (see `resolveToolPath` in
 *   `src/main/paths.ts`).
 */
export interface FileAccessOptions {
  origin?: 'tool'
}

export const TOOL_FILE_ACCESS: FileAccessOptions = { origin: 'tool' }
