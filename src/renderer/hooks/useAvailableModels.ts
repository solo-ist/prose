import { useSettingsStore } from '../stores/settingsStore'
import { availableModelsFor } from '../lib/llm'
import type { ModelInfo } from '../../shared/llm/providers'

/**
 * The models for the provider in use: its live list once fetched, else its
 * seed (#1242). Settings, the status bar and the model dialog all read this,
 * so no picker offers another provider's models.
 */
export function useAvailableModels(): ModelInfo[] {
  const provider = useSettingsStore((s) => s.settings.llm.provider)
  const fetched = useSettingsStore((s) => s.fetchedModels)
  const fetchedFor = useSettingsStore((s) => s.fetchedModelsProvider)
  return availableModelsFor(provider, fetched, fetchedFor)
}
