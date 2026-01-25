import { useState, useEffect, useMemo } from 'react'
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
import { Switch } from '../ui/switch'
import { RemarkableIntegration } from './RemarkableIntegration'
import { GoogleDocsIntegration } from './GoogleDocsIntegration'
import type { Settings } from '../../types'
import { Eye, EyeOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { getModelsForProvider, getDefaultModel, type LLMProvider } from '../../../shared/llm/models'
import { validateApiKeyFormat, validateUrl, maskApiKey } from '../../lib/llm'

export function SettingsDialog() {
  const {
    settings,
    isDialogOpen,
    dialogTab,
    setDialogOpen,
    setDialogTab,
    setTheme,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig,
    setDefaultSaveDirectory,
    setRemarkableConfig,
    setGoogleConfig,
    setAutosaveConfig,
    saveSettings
  } = useSettings()

  // null = unknown/can't detect, true = is default, false = not default
  const [isDefaultHandler, setIsDefaultHandler] = useState<boolean | null>(null)
  const [checkingDefault, setCheckingDefault] = useState(false)

  // API key visibility and testing
  const [showApiKey, setShowApiKey] = useState(false)
  const [testingApiKey, setTestingApiKey] = useState(false)
  const [apiKeyTestResult, setApiKeyTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // Custom model input (for when user wants to enter a model not in the list)
  const [customModel, setCustomModel] = useState(false)

  // Get models for current provider
  const availableModels = useMemo(
    () => getModelsForProvider(settings.llm.provider as LLMProvider),
    [settings.llm.provider]
  )

  // Check if current model is in the list
  const isCustomModel = useMemo(
    () => !availableModels.some(m => m.id === settings.llm.model),
    [availableModels, settings.llm.model]
  )

  // Validation errors
  const apiKeyFormatError = useMemo(
    () => validateApiKeyFormat(settings.llm.provider as LLMProvider, settings.llm.apiKey),
    [settings.llm.provider, settings.llm.apiKey]
  )

  const baseUrlError = useMemo(
    () => validateUrl(settings.llm.baseUrl || ''),
    [settings.llm.baseUrl]
  )

  // Reset API key test result when key changes
  useEffect(() => {
    setApiKeyTestResult(null)
  }, [settings.llm.apiKey, settings.llm.provider])

  // Reset custom model state when provider changes
  useEffect(() => {
    setCustomModel(isCustomModel)
  }, [settings.llm.provider, isCustomModel])

  // Check if we're the default handler when dialog opens
  useEffect(() => {
    if (isDialogOpen && window.api?.fileAssociationIsDefault) {
      setCheckingDefault(true)
      window.api.fileAssociationIsDefault()
        .then((result) => setIsDefaultHandler(result))
        .finally(() => setCheckingDefault(false))
    }
  }, [isDialogOpen])

  const handleSave = async () => {
    await saveSettings()
    setDialogOpen(false)
  }

  const handleProviderChange = (provider: LLMProvider) => {
    // When provider changes, set the default model for that provider
    const defaultModel = getDefaultModel(provider)
    setLLMConfig({ provider, model: defaultModel })
    setCustomModel(false)
    setApiKeyTestResult(null)
  }

  const handleTestApiKey = async () => {
    if (!settings.llm.apiKey || apiKeyFormatError) return

    setTestingApiKey(true)
    setApiKeyTestResult(null)

    try {
      // Use the window.api if available, otherwise show error
      if (window.api?.testApiKey) {
        const result = await window.api.testApiKey({
          provider: settings.llm.provider,
          apiKey: settings.llm.apiKey,
          baseUrl: settings.llm.baseUrl
        })
        setApiKeyTestResult(result)
      } else {
        // Fallback: do a simple validation check
        setApiKeyTestResult({
          success: true,
          message: 'API key format is valid (connection test not available in browser)'
        })
      }
    } catch (error) {
      setApiKeyTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to test API key'
      })
    } finally {
      setTestingApiKey(false)
    }
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={dialogTab} onValueChange={(value) => setDialogTab(value as typeof dialogTab)} className="mt-4">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="llm">LLM</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
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

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="autosave">Autosave</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically save documents after changes
                  </p>
                </div>
                <Switch
                  id="autosave"
                  checked={settings.autosave?.enabled ?? false}
                  onCheckedChange={(checked) => setAutosaveConfig({ enabled: checked })}
                />
              </div>

              {settings.autosave?.enabled && (
                <div className="space-y-2 pl-0">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="autosaveInterval">Save interval</Label>
                    <span className="text-sm text-muted-foreground">
                      {settings.autosave?.intervalSeconds ?? 30}s
                    </span>
                  </div>
                  <Slider
                    value={settings.autosave?.intervalSeconds ?? 30}
                    onChange={(value) => setAutosaveConfig({ intervalSeconds: value })}
                    min={5}
                    max={120}
                    step={5}
                  />
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Default Markdown Editor</Label>
              {checkingDefault ? (
                <p className="text-sm text-muted-foreground">Checking...</p>
              ) : isDefaultHandler === true ? (
                <p className="text-sm text-green-600 dark:text-green-400">
                  ✓ Prose is your default markdown editor
                </p>
              ) : (
                <div className="p-3 bg-muted rounded-md space-y-2">
                  <p className="text-sm">To set Prose as your default markdown editor:</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Right-click any .md file in Finder</li>
                    <li>Select "Get Info" (or press ⌘I)</li>
                    <li>Under "Open with:", select Prose</li>
                    <li>Click "Change All..."</li>
                  </ol>
                </div>
              )}
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
                    IBM Plex Mono (Default)
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
                onValueChange={(value) => handleProviderChange(value as LLMProvider)}
              >
                <SelectTrigger id="provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="model">Model</Label>
                {!customModel && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setCustomModel(true)}
                  >
                    Use custom model
                  </button>
                )}
                {customModel && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setCustomModel(false)
                      // Reset to first model in list if current is custom
                      if (isCustomModel && availableModels.length > 0) {
                        setLLMConfig({ model: availableModels[0].id })
                      }
                    }}
                  >
                    Choose from list
                  </button>
                )}
              </div>
              {customModel ? (
                <Input
                  id="model"
                  value={settings.llm.model}
                  onChange={(e) => setLLMConfig({ model: e.target.value })}
                  placeholder="e.g., claude-sonnet-4-20250514"
                />
              ) : (
                <Select
                  value={settings.llm.model}
                  onValueChange={(value) => setLLMConfig({ model: value })}
                >
                  <SelectTrigger id="model">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex flex-col items-start text-left">
                          <span>{model.name}</span>
                          {model.description && (
                            <span className="text-xs text-muted-foreground">
                              {model.description}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* API Key - always shown for Anthropic */}
            {settings.llm.provider === 'anthropic' && (
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="apiKey"
                      type={showApiKey ? 'text' : 'password'}
                      value={settings.llm.apiKey}
                      onChange={(e) => setLLMConfig({ apiKey: e.target.value })}
                      placeholder="Enter your API key"
                      className={apiKeyFormatError ? 'border-amber-500 pr-10' : 'pr-10'}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowApiKey(!showApiKey)}
                      tabIndex={-1}
                    >
                      {showApiKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestApiKey}
                    disabled={!settings.llm.apiKey || !!apiKeyFormatError || testingApiKey}
                  >
                    {testingApiKey ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Test'
                    )}
                  </Button>
                </div>
                {apiKeyFormatError && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {apiKeyFormatError}
                  </p>
                )}
                {apiKeyTestResult && (
                  <p className={`text-xs flex items-center gap-1 ${
                    apiKeyTestResult.success
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {apiKeyTestResult.success ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <AlertCircle className="h-3 w-3" />
                    )}
                    {apiKeyTestResult.message}
                  </p>
                )}
                {settings.llm.apiKey && !showApiKey && !apiKeyFormatError && (
                  <p className="text-xs text-muted-foreground">
                    Current key: {maskApiKey(settings.llm.apiKey)}
                  </p>
                )}
              </div>
            )}

          </TabsContent>

          <TabsContent value="integrations" className="space-y-4 mt-4">
            <RemarkableIntegration
              settings={settings}
              setRemarkableConfig={setRemarkableConfig}
            />
          </TabsContent>

          <TabsContent value="account" className="space-y-4 mt-4">
            <GoogleDocsIntegration
              settings={settings}
              setGoogleConfig={setGoogleConfig}
            />
          </TabsContent>
        </Tabs>

        <Separator className="my-4" />

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!!apiKeyFormatError}>Save Changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
