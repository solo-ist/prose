/**
 * Feature flags for gating v1.1 features.
 *
 * Flags are persisted in ~/.prose/settings.json under `featureFlags`.
 * To enable a feature without rebuilding, add to settings.json:
 *
 *   "featureFlags": { "googleDocs": true, "remarkable": true }
 *
 * Then relaunch the app.
 */

import { useSettingsStore } from '../stores/settingsStore'

// --- React hooks (for use in components) ---

/** Google Docs bidirectional sync — waitlisted for v1.1 */
export function useGoogleDocsEnabled(): boolean {
  return useSettingsStore((s) => s.settings.featureFlags?.googleDocs === true)
}

/** reMarkable tablet sync — waitlisted for v1.1 */
export function useRemarkableEnabled(): boolean {
  return useSettingsStore((s) => s.settings.featureFlags?.remarkable === true)
}

// --- Non-hook accessors (for use outside React components) ---

export function isGoogleDocsEnabled(): boolean {
  return useSettingsStore.getState().settings.featureFlags?.googleDocs === true
}

export function isRemarkableEnabled(): boolean {
  return useSettingsStore.getState().settings.featureFlags?.remarkable === true
}
