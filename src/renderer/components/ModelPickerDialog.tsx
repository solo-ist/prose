import { useEffect, useState } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from './ui/command'
import { useSettings } from '../hooks/useSettings'
import { useSettingsStore } from '../stores/settingsStore'
import { useModelGroups } from '../hooks/useModelGroups'
import { addKeyLabel } from '../lib/llm'
import type { LLMProvider } from '../../shared/llm/providers'

interface ModelPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ModelPickerDialog({ open, onOpenChange }: ModelPickerDialogProps) {
  const { settings, saveSettings, setDialogOpen } = useSettings()
  const selectModel = useSettingsStore((s) => s.selectModel)
  const [search, setSearch] = useState('')

  // Every provider's models, grouped; a provider without a key offers an "Add a key" row (#1287)
  const modelGroups = useModelGroups()

  // Reset search when dialog opens
  useEffect(() => {
    if (open) {
      setSearch('')
    }
  }, [open])

  const handleSelectModel = async (provider: LLMProvider, modelId: string) => {
    selectModel(provider, modelId)
    await saveSettings()
    onOpenChange(false)
  }

  const handleAddKey = () => {
    onOpenChange(false)
    setDialogOpen(true, 'llm')
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search models..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No models found.</CommandEmpty>
        {modelGroups.map((group) => (
          <CommandGroup key={group.provider} heading={group.label}>
            {group.hasKey ? group.models.map((model) => (
              <CommandItem
                key={model.id}
                // The provider's name is searchable too: "openai" finds its models.
                value={`${group.label} ${model.name} ${model.id}`}
                onSelect={() => handleSelectModel(group.provider, model.id)}
                className="flex items-center justify-between"
              >
                <div className="flex flex-col">
                  <span>{model.name}</span>
                  {model.description && (
                    <span className="text-xs text-muted-foreground">{model.description}</span>
                  )}
                </div>
                {group.provider === settings.llm.provider && model.id === settings.llm.model && (
                  <span className="text-primary ml-2">Current</span>
                )}
              </CommandItem>
            )) : (
              <CommandItem
                value={`${group.label} ${addKeyLabel(group.label)}`}
                onSelect={handleAddKey}
                className="text-muted-foreground"
              >
                {addKeyLabel(group.label)} in Settings → LLM
              </CommandItem>
            )}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
