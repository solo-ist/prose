import { useMemo } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { modelGroups, type ModelGroup } from '../lib/llm'

/**
 * Every provider's models, grouped (#1287): each keyed provider's live list
 * once fetched, else its seed; a provider without a key lists none. `models`
 * is the shown set the pickers list (#1322), `allModels` everything on offer.
 * Settings, the status bar and the model dialog all read this.
 */
export function useModelGroups(): ModelGroup[] {
  const keyStatus = useSettingsStore((s) => s.settings.llm.keyStatus)
  const provider = useSettingsStore((s) => s.settings.llm.provider)
  const model = useSettingsStore((s) => s.settings.llm.model)
  const shownModels = useSettingsStore((s) => s.settings.llm.shownModels)
  const live = useSettingsStore((s) => s.liveModels)
  return useMemo(
    () => modelGroups({ keyStatus, provider, model, shownModels }, live),
    [keyStatus, provider, model, shownModels, live]
  )
}
