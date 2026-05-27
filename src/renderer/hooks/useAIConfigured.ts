import { useSettingsStore } from '../stores/settingsStore'
import { validateConfig, type AIAvailability } from '../lib/llm'

/**
 * Reactive AI availability for components. Re-renders only when consent or
 * LLM config validity actually changes (selects primitives, not a derived
 * object, so it doesn't churn on unrelated settings updates). Use to
 * disable/annotate AI controls and to choose the right "not available"
 * message. For callbacks/stores outside React, call `aiAvailability(settings)`
 * / `isAIConfigured(settings)` directly.
 */
export function useAIConfigured(): AIAvailability {
  const consented = useSettingsStore((s) => Boolean(s.settings.aiConsent?.consented))
  const configError = useSettingsStore((s) => validateConfig(s.settings.llm))

  if (!consented) return { available: false, reason: 'no-consent' }
  if (configError !== null) return { available: false, reason: 'no-config' }
  return { available: true, reason: null }
}
