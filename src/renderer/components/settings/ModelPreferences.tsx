import { useSettingsStore } from '../../stores/settingsStore'
import { Label } from '../ui/label'
import { Checkbox } from '../ui/checkbox'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '../ui/select'
import { shownModelIds, type ModelGroup } from '../../lib/llm'
import { getProvider, isProvider, type LLMProvider } from '../../../shared/llm/providers'
import { modelNames } from '../../../shared/llm/modelNames'
import type { ToolMode } from '../../../shared/tools/types'

const MODES: Array<{ mode: ToolMode; label: string }> = [
  { mode: 'chat', label: 'Chat' },
  { mode: 'editor', label: 'Editor' },
  { mode: 'create', label: 'Create' },
]

/** The select's value for "no default": Radix has no empty value. */
const NO_DEFAULT = 'none'
const valueOf = (provider: LLMProvider, model: string) => `${provider}::${model}`

/**
 * Settings → LLM, below the model select (#1322): which of each provider's
 * models the pickers show, and the model each mode switches to.
 */
export function ModelPreferences({ groups }: { groups: ModelGroup[] }) {
  const llm = useSettingsStore((s) => s.settings.llm)
  const setShownModels = useSettingsStore((s) => s.setShownModels)
  const setModeModel = useSettingsStore((s) => s.setModeModel)
  const keyed = groups.filter((g) => g.hasKey)
  if (keyed.length === 0) return null

  const toggle = (provider: LLMProvider, id: string, checked: boolean) => {
    const shown = shownModelIds(provider, llm)
    setShownModels(provider, checked ? [...shown.filter((m) => m !== id), id] : shown.filter((m) => m !== id))
  }

  return (
    <>
      <div className="space-y-2">
        <Label>Default model per mode</Label>
        <p className="text-xs text-muted-foreground">
          Switching to a mode switches to its model. With no default, the model in use stays.
        </p>
        <div className="space-y-1.5">
          {MODES.map(({ mode, label }) => {
            const choice = llm.modeModels?.[mode]
            const value = choice ? valueOf(choice.provider, choice.model) : NO_DEFAULT
            // A default the pickers no longer list (unchecked since, or its key cleared) still shows as chosen.
            const listed = keyed.some((g) => g.models.some((m) => valueOf(g.provider, m.id) === value))
            return (
              <div key={mode} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-sm">{label}</span>
                <Select
                  value={value}
                  onValueChange={(next) => {
                    if (next === NO_DEFAULT) return setModeModel(mode, null)
                    const at = next.indexOf('::')
                    const provider = next.slice(0, at)
                    if (isProvider(provider)) setModeModel(mode, { provider, model: next.slice(at + 2) })
                  }}
                >
                  <SelectTrigger aria-label={`Default model for ${label} mode`} data-testid={`mode-model-${mode}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DEFAULT}>No default</SelectItem>
                    {choice && !listed && (
                      <SelectItem value={value}>
                        {modelNames(choice.provider, choice.model).long}
                      </SelectItem>
                    )}
                    {keyed.map((group) => (
                      <SelectGroup key={group.provider}>
                        <SelectLabel>{group.label}</SelectLabel>
                        {group.models.map((model) => (
                          <SelectItem key={model.id} value={valueOf(group.provider, model.id)}>
                            {model.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Models in menus</Label>
        <p className="text-xs text-muted-foreground">
          Checked models appear in the model list above, the status bar and Switch model (⇧⌘M). The model in use is
          always listed, and with none checked every model is.
        </p>
        {keyed.map((group) => {
          const shown = shownModelIds(group.provider, llm)
          const customised = !!llm.shownModels?.[group.provider]
          const count = group.allModels.filter((m) => shown.includes(m.id)).length
          return (
            <details key={group.provider} className="rounded-md border border-border" data-testid={`shown-models-${group.provider}`}>
              <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm">
                <span>{group.label}</span>
                <span className="text-xs text-muted-foreground">
                  {count} of {group.allModels.length} shown
                </span>
              </summary>
              <div className="space-y-1.5 border-t border-border px-3 py-2">
                {group.allModels.map((model) => {
                  const id = `shown-${group.provider}-${model.id}`
                  return (
                    <div key={model.id} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={shown.includes(model.id)}
                        onCheckedChange={(checked) => toggle(group.provider, model.id, checked === true)}
                      />
                      <label htmlFor={id} className="flex-1 cursor-pointer text-sm">
                        {model.name}
                        <span className="ml-2 text-xs text-muted-foreground">{model.id}</span>
                      </label>
                    </div>
                  )
                })}
                {customised && (
                  <button
                    type="button"
                    className="pt-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShownModels(group.provider, null)}
                  >
                    Reset to {getProvider(group.provider).label}'s defaults
                  </button>
                )}
              </div>
            </details>
          )
        })}
      </div>
    </>
  )
}
