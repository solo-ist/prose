import { useSettingsStore } from '../stores/settingsStore'

/**
 * The writer's name from Settings → General (#1232), for labelling their own
 * records. Empty when unset; `actorLabel` then shows "You".
 */
export function useSelfName(): string {
  return useSettingsStore((s) => s.settings.user?.name ?? '')
}

/** The same outside React (tooltips, tool results). */
export function getSelfName(): string {
  return useSettingsStore.getState().settings.user?.name ?? ''
}
