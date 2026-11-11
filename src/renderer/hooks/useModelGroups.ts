import { useMemo } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { modelGroups, type ModelGroup } from '../lib/llm'

/**
 * Every provider's models, grouped (#1287): each keyed provider's live list
 * once fetched, else its seed; a provider without a key lists none. Settings,
 * the status bar and the model dialog all read this.
 */
export function useModelGroups(): ModelGroup[] {
  const keyStatus = useSettingsStore((s) => s.settings.llm.keyStatus)
  const live = useSettingsStore((s) => s.liveModels)
  return useMemo(() => modelGroups(keyStatus, live), [keyStatus, live])
}
