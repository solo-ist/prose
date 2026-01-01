import { useSettings } from '../../hooks/useSettings'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import { Slider } from '../ui/slider'
import type { Settings } from '../../types'

export function SettingsDialog() {
  const {
    settings,
    isDialogOpen,
    setDialogOpen,
    setTheme,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig,
    setDefaultSaveDirectory,
    saveSettings
  } = useSettings()

  const handleSave = async () => {
    await saveSettings()
    setDialogOpen(false)
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="llm">LLM</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="theme">Theme</Label>
              <Select
                value={settings.theme}
                onValueChange={(value) => setTheme(value as Settings['theme'])}
              >
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="recovery">Draft Recovery</Label>
              <Select
                value={settings.recovery?.mode ?? 'silent'}
                onValueChange={(value) =>
                  setRecoveryConfig({
                    mode: value as 'silent' | 'prompt'
                  })
                }
              >
                <SelectTrigger id="recovery">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="silent">Auto-recover</SelectItem>
                  <SelectItem value="prompt">Ask before recovering</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose how to handle unsaved work when the app restarts
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="defaultSaveDirectory">Default Save Location</Label>
              <div className="flex gap-2">
                <Input
                  id="defaultSaveDirectory"
                  value={settings.defaultSaveDirectory || ''}
                  onChange={(e) => setDefaultSaveDirectory(e.target.value)}
                  placeholder="~/Documents"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    const folder = await window.api?.selectFolder()
                    if (folder) {
                      setDefaultSaveDirectory(folder)
                    }
                  }}
                >
                  Browse...
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Where new documents are saved when you quick-save from the title bar
              </p>
            </div>
          </TabsContent>

          <TabsContent value="editor" className="space-y-6 mt-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="fontSize">Font Size</Label>
                <span className="text-sm text-muted-foreground">
                  {settings.editor.fontSize}px
                </span>
              </div>
              <Slider
                value={settings.editor.fontSize}
                onChange={(value) => setEditorConfig({ fontSize: value })}
                min={12}
                max={24}
                step={1}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="lineHeight">Line Height</Label>
                <span className="text-sm text-muted-foreground">
                  {settings.editor.lineHeight.toFixed(1)}
                </span>
              </div>
              <Slider
                value={settings.editor.lineHeight}
                onChange={(value) => setEditorConfig({ lineHeight: value })}
                min={1}
                max={2.5}
                step={0.1}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fontFamily">Font Family</Label>
              <Select
                value={settings.editor.fontFamily}
                onValueChange={(value) => setEditorConfig({ fontFamily: value })}
              >
                <SelectTrigger id="fontFamily">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='"IBM Plex Mono", monospace'>
                    IBM Plex Mono
                  </SelectItem>
                  <SelectItem value='"IBM Plex Sans", sans-serif'>
                    IBM Plex Sans
                  </SelectItem>
                  <SelectItem value='"Fira Mono", monospace'>
                    Fira Mono
                  </SelectItem>
                  <SelectItem value='"Cutive Mono", monospace'>
                    Cutive Mono
                  </SelectItem>
                  <SelectItem value='"Source Code Pro", monospace'>
                    Source Code Pro
                  </SelectItem>
                  <SelectItem value='ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'>
                    System Mono
                  </SelectItem>
                  <SelectItem value='ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'>
                    Serif
                  </SelectItem>
                  <SelectItem value='ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'>
                    Sans Serif
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="llm" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Select
                value={settings.llm.provider}
                onValueChange={(value) =>
                  setLLMConfig({ provider: value as Settings['llm']['provider'] })
                }
              >
                <SelectTrigger id="provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                  <SelectItem value="ollama">Ollama</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                value={settings.llm.model}
                onChange={(e) => setLLMConfig({ model: e.target.value })}
                placeholder="e.g., claude-sonnet-4-20250514"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                value={settings.llm.apiKey}
                onChange={(e) => setLLMConfig({ apiKey: e.target.value })}
                placeholder="Enter your API key"
              />
            </div>

            {(settings.llm.provider === 'ollama' ||
              settings.llm.provider === 'openrouter') && (
              <div className="space-y-2">
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input
                  id="baseUrl"
                  value={settings.llm.baseUrl || ''}
                  onChange={(e) => setLLMConfig({ baseUrl: e.target.value })}
                  placeholder={
                    settings.llm.provider === 'ollama'
                      ? 'http://localhost:11434'
                      : 'https://openrouter.ai/api/v1'
                  }
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="account" className="space-y-4 mt-4">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">Google Account</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Connect your Google account to sync documents across devices.
                </p>
                <Button variant="outline" disabled>
                  Connect Google Account
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Coming soon
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <Separator className="my-4" />

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
