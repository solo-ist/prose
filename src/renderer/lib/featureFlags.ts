/**
 * Feature flags for gating optional/staged features.
 *
 * Flags live under `featureFlags` in settings.json. Default per-flag below;
 * users override via:
 *
 *   "featureFlags": { "googleDocs": true, "remarkable": false }
 *
 * Then relaunch the app.
 *
 * MAS gate: features that depend on capabilities incompatible with the Mac
 * App Store sandbox or distribution rules are forced off when the build was
 * stamped with MAS_BUILD=1, regardless of user setting. The renderer reads
 * this through the preload-exposed `window.api.isMasBuild`.
 */

import { useSettingsStore } from '../stores/settingsStore'

function isMasBuild(): boolean {
  return typeof window !== 'undefined' && window.api?.isMasBuild === true
}

// --- React hooks (for use in components) ---

/** Google Docs bidirectional sync — opt-in via settings.featureFlags.googleDocs. */
export function useGoogleDocsEnabled(): boolean {
  return useSettingsStore((s) => s.settings.featureFlags?.googleDocs === true)
}

/**
 * reMarkable tablet sync — default-on for desktop builds, force-off for MAS.
 *
 * Default-on: anything other than an explicit `false` enables the feature, so
 * existing users on the new release pick it up without touching settings.
 *
 * MAS-off: the reMarkable Cloud auth flow and the OCR Lambda credentials
 * pattern aren't ready for App Store review, so MAS builds never see the
 * feature regardless of what's in their settings.json.
 */
export function useRemarkableEnabled(): boolean {
  return useSettingsStore((s) => {
    if (isMasBuild()) return false
    return s.settings.featureFlags?.remarkable !== false
  })
}

// --- Non-hook accessors (for use outside React components) ---

export function isGoogleDocsEnabled(): boolean {
  return useSettingsStore.getState().settings.featureFlags?.googleDocs === true
}

export function isRemarkableEnabled(): boolean {
  if (isMasBuild()) return false
  return useSettingsStore.getState().settings.featureFlags?.remarkable !== false
}
