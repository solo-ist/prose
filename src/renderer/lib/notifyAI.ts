import { useNotificationStore } from '../stores/notificationStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useChatStore } from '../stores/chatStore'
import { aiAvailability, aiUnavailableMessage } from './llm'

/** Fixed id so repeated triggers refresh one toast rather than stacking. */
const AI_NOTIFICATION_ID = 'ai-not-configured'

/**
 * Fire a visible toast explaining why AI can't be used, with an action that
 * opens Settings to the LLM tab. Call from any blocked user-initiated AI
 * action so feedback shows regardless of chat-panel visibility (the original
 * #631 gap — the only error landed in a panel that may be closed).
 *
 * No-ops when AI is actually available, so it's safe to call defensively.
 */
export function notifyAINotConfigured(): void {
  const { settings } = useSettingsStore.getState()
  const { available, reason } = aiAvailability(settings)
  if (available || !reason) return

  // When the chat panel is open, the inline notice + the assistant message
  // already make this visible — a toast would be a redundant third copy. The
  // toast is for the panel-closed case (the #631 "errors might've errored" gap).
  if (useChatStore.getState().isPanelOpen) return

  useNotificationStore.getState().notify({
    id: AI_NOTIFICATION_ID,
    message: aiUnavailableMessage(reason),
    actionLabel: 'Open Settings',
    onAction: () => useSettingsStore.getState().setDialogOpen(true, 'llm')
  })
}
