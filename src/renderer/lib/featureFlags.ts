/**
 * Feature flags for gating optional/staged features.
 *
 * Flags live under `featureFlags` in settings.json. Default per-flag below;
 * users override via:
 *
 *   "featureFlags": { "remarkable": false }
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

/**
 * Web platform (gateway accounts + share/publish surfaces, #768/#771) —
 * default ON for direct-download builds since 1.8.1 (#943), force-off for MAS.
 *
 * On by default: anyone can sign in and see Share; publishing is gated by the
 * gateway's share_publish grant, and users without one get Request access
 * (the waitlist, #1018). An explicit `false` in settings.json turns it off.
 *
 * MAS-off: the hosted surfaces belong to the self-distributed build; MAS
 * builds never see them regardless of settings.json.
 *
 * Every reader goes through `webPlatformOn` so the default lives in one place.
 */
export function webPlatformOn(flags: { webPlatform?: boolean } | undefined): boolean {
  if (isMasBuild()) return false
  return flags?.webPlatform !== false
}

export function useWebPlatformEnabled(): boolean {
  return useSettingsStore((s) => webPlatformOn(s.settings.featureFlags))
}

// --- Non-hook accessors (for use outside React components) ---

export function isWebPlatformEnabled(): boolean {
  return webPlatformOn(useSettingsStore.getState().settings.featureFlags)
}

export function isRemarkableEnabled(): boolean {
  if (isMasBuild()) return false
  return useSettingsStore.getState().settings.featureFlags?.remarkable !== false
}
