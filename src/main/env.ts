/**
 * Build-time environment helpers for the main process.
 *
 * __IS_MAS_BUILD__ is injected by electron-vite's DefinePlugin (see electron-vite.config.ts).
 * It evaluates to `true` when MAS_BUILD=1 is set at build time, `false` otherwise.
 * Centralizing the check here prevents the verbose typeof guard from being duplicated
 * at every call site and ensures future renames/removals break at one place.
 */

declare const __IS_MAS_BUILD__: boolean

export function isMASBuild(): boolean {
  return typeof __IS_MAS_BUILD__ !== 'undefined' && __IS_MAS_BUILD__
}
