/**
 * Feature flags for gating v1.1 features.
 *
 * To enable a feature locally without rebuilding:
 *   localStorage.setItem('ff:google-docs', 'true')
 *   localStorage.setItem('ff:remarkable', 'true')
 * Then reload the app (Cmd+R).
 *
 * To disable again:
 *   localStorage.removeItem('ff:google-docs')
 */

function isEnabled(key: string, defaultValue: boolean): boolean {
  try {
    const override = localStorage.getItem(`ff:${key}`)
    if (override !== null) return override === 'true'
  } catch {
    // localStorage unavailable (e.g., in tests)
  }
  return defaultValue
}

/** Google Docs bidirectional sync — waitlisted for v1.1 */
export const GOOGLE_DOCS_ENABLED = isEnabled('google-docs', false)

/** reMarkable tablet sync — waitlisted for v1.1 */
export const REMARKABLE_ENABLED = isEnabled('remarkable', false)
