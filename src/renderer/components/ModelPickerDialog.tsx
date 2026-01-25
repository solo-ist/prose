import { useEffect, useState, useMemo } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from './ui/command'
import { useSettings } from '../hooks/useSettings'
import { getModelsForProvider, type LLMProvider, type ModelInfo } from '../../shared/llm/models'

interface ModelPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ModelPickerDialog({ open, onOpenChange }: ModelPickerDialogProps) {
  const { settings, setLLMConfig, saveSettings } = useSettings()
  const [search, setSearch] = useState('')

  // Get available models for current provider
  const availableModels = useMemo(
    () => getModelsForProvider(settings.llm.provider as LLMProvider),
    [settings.llm.provider]
  )

  // Reset search when dialog opens
  useEffect(() => {
    if (open) {
      setSearch('')
    }
  }, [open])

  const handleSelectModel = async (model: ModelInfo) => {
    setLLMConfig({ model: model.id })
    await saveSettings()
    onOpenChange(false)
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
        <CommandGroup heading={`${settings.llm.provider} models`}>
          {availableModels.map((model) => (
            <CommandItem
              key={model.id}
              value={model.name}
              onSelect={() => handleSelectModel(model)}
              className="flex items-center justify-between"
            >
              <div className="flex flex-col">
                <span>{model.name}</span>
                {model.description && (
                  <span className="text-xs text-muted-foreground">{model.description}</span>
                )}
              </div>
              {model.id === settings.llm.model && (
                <span className="text-primary ml-2">Current</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
