import type { Tab } from '../stores/tabStore'

export type AutosaveMode = 'off' | 'auto' | 'custom'

export interface AutosavePlan {
  /** Tabs whose timer is (re)armed. */
  arm: string[]
  /** Tabs whose pending timer is cleared. */
  clear: string[]
}

/**
 * Which tabs' autosave timers to arm and which to clear after a tab-store
 * change (#1151). Pure: the hook applies the plan.
 *
 * - `auto`: a dirty tab with a path re-arms its debounce whenever its content
 *   or frontmatter was replaced (a projection landed: typing stopped), on the
 *   clean→dirty transition and on a path change; a clean tab clears.
 * - `custom`: the clean→dirty transition (or a path change while dirty) arms
 *   the interval once; a clean tab clears.
 * - `off`: every tab that could hold a timer clears.
 * - A tab that arrived dirty (a restored draft) waits for its first edit; a
 *   tab that left the store clears.
 */
export function planAutosave(prev: readonly Tab[], next: readonly Tab[], mode: AutosaveMode): AutosavePlan {
  const arm: string[] = []
  const clear: string[] = []
  const before = new Map(prev.map((t) => [t.id, t]))
  for (const tab of next) {
    const was = before.get(tab.id)
    before.delete(tab.id)
    const eligible = mode !== 'off' && !!tab.path && tab.isDirty
    if (!eligible) {
      if (was && was.isDirty && was.path) clear.push(tab.id)
      continue
    }
    if (!was) continue
    const wentDirty = !was.isDirty
    const pathChanged = was.path !== tab.path
    if (mode === 'custom') {
      if (wentDirty || pathChanged) arm.push(tab.id)
      continue
    }
    if (wentDirty || pathChanged || was.content !== tab.content || was.frontmatter !== tab.frontmatter) arm.push(tab.id)
  }
  for (const id of before.keys()) clear.push(id)
  return { arm, clear }
}
