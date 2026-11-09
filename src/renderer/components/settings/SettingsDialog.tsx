import { useState, useEffect, useMemo, useRef } from 'react'
import { useSettings } from '../../hooks/useSettings'
import { useSettingsStore } from '../../stores/settingsStore'
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
import { AppearancePane } from './AppearancePane'
import { RemarkableIntegration } from './RemarkableIntegration'
import { McpIntegration } from './McpIntegration'
import { McpConnections } from './McpConnections'
import { RemoteAccess, useRemotePendingCount } from './RemoteAccess'
import { AccountSection } from '../account/AccountSection'
import { ProseSkillIntegration } from './ProseSkillIntegration'
import { isWebMode } from '../../lib/browserApi'
import { cn } from '../../lib/utils'
import { isMasBuild } from '../../lib/featureFlags'
import { AppStoreImportSettingsRow } from '../appStoreImport/AppStoreImportDialogs'
import type { Settings } from '../../types'
import { AlertCircle } from 'lucide-react'
import { getDefaultModel, type LLMProvider } from '../../../shared/llm/models'
import { PROVIDERS, PROVIDER_IDS } from '../../../shared/llm/providers'
import { ProviderKeys, draftFormatError, type KeyDrafts } from './ProviderKeys'
import { useAvailableModels } from '../../hooks/useAvailableModels'
import { validateUrl, hasProviderKey } from '../../lib/llm'

/** Extract the primary font name from a CSS font-family stack */
function extractPrimaryFont(fontFamily: string): string {
  // Strip quotes and take first font in the stack
  const primary = fontFamily.split(',')[0].trim().replace(/['"]/g, '')
  // Map known system stacks to friendly names
  if (primary === 'ui-monospace') return 'System Mono'
  if (primary === 'ui-serif') return 'Serif'
  if (primary === 'ui-sans-serif') return 'Sans Serif'
  return primary
}

/** Font CSS stacks keyed by primary font name */
const FONT_STACKS: Record<string, string> = {
  'IBM Plex Mono': "'IBM Plex Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  'IBM Plex Sans': "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
  'Fira Mono': "'Fira Mono', ui-monospace, monospace",
  'Cutive Mono': "'Cutive Mono', ui-monospace, monospace",
  'Source Code Pro': "'Source Code Pro', ui-monospace, monospace",
  'System Mono': "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  'Serif': "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  'Sans Serif': "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}

export function SettingsDialog() {
  const {
    settings,
    isDialogOpen,
    dialogTab,
    effectiveTheme,
    setDialogOpen,
    setDialogTab,
    setAppearance,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig,
    setDefaultSaveDirectory,
    setRemarkableConfig,
    setAutosaveConfig,
    saveSettings
  } = useSettings()

  const setAIConsent = useSettingsStore((s) => s.setAIConsent)
  const setAIConsentDialogOpen = useSettingsStore((s) => s.setAIConsentDialogOpen)

  const aiEnabled = settings.aiConsent?.consented === true

  const handleAIToggle = (enabled: boolean) => {
    if (enabled && !settings.aiConsent?.consented) {
      // Show consent dialog if not yet consented
      setAIConsentDialogOpen(true)
    } else {
      setAIConsent(enabled)
    }
  }

  // null = unknown/can't detect, true = is default, false = not default
  const [isDefaultHandler, setIsDefaultHandler] = useState<boolean | null>(null)
  const [checkingDefault, setCheckingDefault] = useState(false)

  // API keys, one per provider. Main holds the saved keys (#1240); the dialog
  // sees each one's status and keeps a typed key only as a local draft until
  // Save Changes hands it over (#1242).
  const setLlmKey = useSettingsStore((s) => s.setLlmKey)
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider)
  const [keyDrafts, setKeyDrafts] = useState<KeyDrafts>({})
  const [keySaveErrors, setKeySaveErrors] = useState<Partial<Record<LLMProvider, string>>>({})
  const anyDraftInvalid = PROVIDER_IDS.some((p) => draftFormatError(p, keyDrafts) !== null)

  // Secure storage availability
  const [secureStorageAvailable, setSecureStorageAvailable] = useState<boolean | null>(null)

  // Custom model input (for when user wants to enter a model not in the list)
  const [customModel, setCustomModel] = useState(false)

  // Refs for scrollable tab content
  const generalTabRef = useRef<HTMLDivElement>(null)
  const appearanceTabRef = useRef<HTMLDivElement>(null)
  const editorTabRef = useRef<HTMLDivElement>(null)
  const llmTabRef = useRef<HTMLDivElement>(null)
  const integrationsTabRef = useRef<HTMLDivElement>(null)
  const accountTabRef = useRef<HTMLDivElement>(null)

  // The provider in use's models: its live list once fetched, else its seed.
  const isFetchingModels = useSettingsStore((s) => s.isFetchingModels)
  const fetchModels = useSettingsStore((s) => s.fetchModels)
  const availableModels = useAvailableModels()

  // Check if current model is in the list
  const isCustomModel = useMemo(
    () => !availableModels.some(m => m.id === settings.llm.model),
    [availableModels, settings.llm.model]
  )

  const baseUrlError = useMemo(
    () => validateUrl(settings.llm.baseUrl || ''),
    [settings.llm.baseUrl]
  )

  // A draft never outlives the dialog.
  useEffect(() => {
    setKeyDrafts({})
    setKeySaveErrors({})
  }, [isDialogOpen])

  // Reset custom model state when provider changes
  useEffect(() => {
    setCustomModel(isCustomModel)
  }, [settings.llm.provider, isCustomModel])

  // Check secure storage availability when dialog opens
  useEffect(() => {
    if (isDialogOpen && window.api?.isSecureStorageAvailable) {
      window.api.isSecureStorageAvailable().then(setSecureStorageAvailable)
    }
  }, [isDialogOpen])

  // Refresh the live model list when the dialog opens (if API key is set)
  const hasKey = hasProviderKey(settings.llm)
  useEffect(() => {
    if (isDialogOpen && hasKey) {
      fetchModels()
    }
  }, [isDialogOpen, hasKey, settings.llm.provider, fetchModels])

  // Check if we're the default handler when dialog opens
  useEffect(() => {
    if (isDialogOpen && window.api?.fileAssociationIsDefault) {
      setCheckingDefault(true)
      window.api.fileAssociationIsDefault()
        .then((result) => setIsDefaultHandler(result))
        .finally(() => setCheckingDefault(false))
    }
  }, [isDialogOpen])

  // The App Store build has no account (sharing is direct-download only) and no
  // integrations (MCP, the Claude skill and reMarkable are all off there), so it is
  // not offered those tabs at all rather than shown them empty (#1222). A request
  // for one of them (a stale `dialogTab`, a caller naming it) renders General.
  const isMas = isMasBuild()
  // Remote clients waiting for approval (#1239): counted on the Integrations tab.
  const remotePending = useRemotePendingCount()
  const activeTab = isMas && (dialogTab === 'integrations' || dialogTab === 'account') ? 'general' : dialogTab

  const handleSave = async () => {
    // Each typed key goes to main, which stores it; then the rest of the settings.
    const errors: Partial<Record<LLMProvider, string>> = {}
    for (const provider of PROVIDER_IDS) {
      const draft = keyDrafts[provider]?.trim()
      if (!draft || draftFormatError(provider, keyDrafts)) continue
      const result = await setLlmKey(provider, draft)
      if (result.ok) {
        setKeyDrafts((d) => ({ ...d, [provider]: undefined }))
      } else {
        errors[provider] = result.error || 'The key could not be saved'
      }
    }
    setKeySaveErrors(errors)
    if (Object.keys(errors).length > 0) return
    await saveSettings()
    setDialogOpen(false)
  }

  const handleTabChange = (value: string) => {
    // Reset scroll on the outgoing (currently visible) tab.
    // The incoming tab is still hidden at this point, so browsers
    // ignore scrollTop changes on it. Resetting the outgoing tab
    // ensures it starts at the top when the user returns to it.
    const tabRefs: Record<string, React.RefObject<HTMLDivElement>> = {
      general: generalTabRef,
      appearance: appearanceTabRef,
      editor: editorTabRef,
      llm: llmTabRef,
      integrations: integrationsTabRef,
      account: accountTabRef
    }

    const outgoingRef = tabRefs[activeTab]
    if (outgoingRef?.current) {
      outgoingRef.current.scrollTop = 0
    }

    setDialogTab(value as typeof dialogTab)
  }

  const handleProviderChange = (provider: LLMProvider) => {
    // The provider in use changes; every key stays where it is, and the model
    // last used with this provider comes back (else its default).
    setActiveProvider(provider)
    setCustomModel(false)
  }



  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="mt-4 flex-1 min-h-0 flex flex-col">
          <TabsList className={cn('grid w-full shrink-0', isMas ? 'grid-cols-4' : 'grid-cols-6')} data-testid="settings-tabs">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="llm">LLM</TabsTrigger>
            {!isMas && (
              <TabsTrigger value="integrations">
                Integrations
                {remotePending > 0 && (
                  <span
                    className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-medium leading-4 text-white"
                    aria-label={`${remotePending} waiting for approval`}
                    data-testid="integrations-pending-count"
                  >
                    {remotePending}
                  </span>
                )}
              </TabsTrigger>
            )}
            {!isMas && <TabsTrigger value="account">Account</TabsTrigger>}
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4 overflow-y-auto flex-1 px-1 -mx-1" ref={generalTabRef}>
            <div className="space-y-2">
              <Label htmlFor="userName">Your Name</Label>
              <Input
                id="userName"
                value={settings.user?.name ?? ''}
                onChange={(e) => useSettingsStore.getState().setUserIdentity({ name: e.target.value })}
                placeholder="You"
                maxLength={100}
                autoComplete="name"
              />
              <p className="text-xs text-muted-foreground">
                Shown on your comments, replies and decisions, beside the agents and reviewers who also leave them
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="userEmail">Email (optional)</Label>
              <Input
                id="userEmail"
                type="email"
                value={settings.user?.email ?? ''}
                onChange={(e) => useSettingsStore.getState().setUserIdentity({ email: e.target.value })}
                placeholder="you@example.com"
                maxLength={254}
                autoComplete="email"
              />
              <p className="text-xs text-muted-foreground">
                Stays on this Mac: it is never stored on your comments or sent to agents or share viewers
              </p>
            </div>

            <Separator />

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
                    const result = await window.api?.selectFolder()
                    if (result) {
                      setDefaultSaveDirectory(result.path)
                      if (result.bookmark) {
                        // Persist bookmark for MAS sandbox access across restarts
                        useSettingsStore.setState((state) => ({
                          settings: { ...state.settings, masDirectoryBookmark: result.bookmark! }
                        }))
                        saveSettings()
                      }
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
              <div className="space-y-2">
                <Label htmlFor="autosaveMode">Autosave</Label>
                <Select
                  value={settings.autosave?.mode ?? 'off'}
                  onValueChange={(value) => setAutosaveConfig({ mode: value as 'off' | 'auto' | 'custom' })}
                >
                  <SelectTrigger id="autosaveMode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {settings.autosave?.mode === 'auto' && 'Save after you stop typing'}
                  {settings.autosave?.mode === 'custom' && 'Save at a custom interval'}
                  {(!settings.autosave?.mode || settings.autosave?.mode === 'off') && 'Manual save only'}
                </p>
              </div>

              {settings.autosave?.mode === 'custom' && (
                <div className="space-y-2">
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
                    max={300}
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

            <Separator />

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 flex-1">
                <Label htmlFor="errorTracking">Error Reporting</Label>
                <p className="text-xs text-muted-foreground">
                  Send anonymous crash reports to help improve Prose. No document content is included.
                </p>
              </div>
              <Switch
                id="errorTracking"
                checked={settings.errorTracking?.enabled ?? false}
                onCheckedChange={(checked) => {
                  useSettingsStore.getState().setErrorTracking(checked)
                }}
              />
            </div>

            <AppStoreImportSettingsRow />
          </TabsContent>

          <TabsContent value="appearance" className="mt-4 overflow-y-auto flex-1 min-h-0 flex flex-col px-0 mx-0" ref={appearanceTabRef}>
            <AppearancePane
              appearance={settings.appearance}
              effectiveMode={effectiveTheme}
              onAppearanceChange={setAppearance}
            />
          </TabsContent>

          <TabsContent value="editor" className="space-y-6 mt-4 overflow-y-auto flex-1 px-1 -mx-1" ref={editorTabRef}>
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
                value={extractPrimaryFont(settings.editor.fontFamily)}
                onValueChange={(value) => setEditorConfig({ fontFamily: FONT_STACKS[value] || value })}
              >
                <SelectTrigger id="fontFamily">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IBM Plex Mono">
                    IBM Plex Mono (Default)
                  </SelectItem>
                  <SelectItem value="IBM Plex Sans">
                    IBM Plex Sans
                  </SelectItem>
                  <SelectItem value="Fira Mono">
                    Fira Mono
                  </SelectItem>
                  <SelectItem value="Cutive Mono">
                    Cutive Mono
                  </SelectItem>
                  <SelectItem value="Source Code Pro">
                    Source Code Pro
                  </SelectItem>
                  <SelectItem value="System Mono">
                    System Mono
                  </SelectItem>
                  <SelectItem value="Serif">
                    Serif
                  </SelectItem>
                  <SelectItem value="Sans Serif">
                    Sans Serif
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bulletListMarker">Bullet List Marker</Label>
              <Select
                value={settings.editor.bulletListMarker ?? '*'}
                onValueChange={(value) => setEditorConfig({ bulletListMarker: value as '-' | '*' })}
              >
                <SelectTrigger id="bulletListMarker">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="-">Dash ( - )</SelectItem>
                  <SelectItem value="*">Asterisk ( * )</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="llm" className="space-y-4 mt-4 overflow-y-auto flex-1 px-1 -mx-1" ref={llmTabRef}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 flex-1">
                <Label htmlFor="aiEnabled">Enable AI Features</Label>
                <p className="text-xs text-muted-foreground">
                  When active, text and document content is sent to your configured AI provider.
                  Requires your own API key — no data is stored by Prose.
                </p>
              </div>
              <Switch
                id="aiEnabled"
                checked={aiEnabled}
                onCheckedChange={handleAIToggle}
              />
            </div>

            <Separator />

            <div className={!aiEnabled ? 'opacity-50 pointer-events-none' : ''}>
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
                  {PROVIDER_IDS.map((id) => (
                    <SelectItem key={id} value={id}>{PROVIDERS[id].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="model">Model{isFetchingModels && <span className="ml-2 text-xs text-muted-foreground">refreshing…</span>}</Label>
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
                  placeholder={`e.g., ${getDefaultModel(settings.llm.provider as LLMProvider)}`}
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

            {/* API keys: one per provider, all visible (#1242) */}
              <div className="space-y-2">
                <Label>API Keys</Label>
                <p className="text-xs text-muted-foreground">
                  Each provider keeps its own key; switching the provider in use never removes one. Keys stay in the
                  macOS Keychain and are only ever sent to their provider.
                </p>
                <ProviderKeys
                  active={settings.llm.provider as LLMProvider}
                  keyStatus={settings.llm.keyStatus}
                  drafts={keyDrafts}
                  onDraftChange={(provider, draft) => {
                    setKeyDrafts((d) => ({ ...d, [provider]: draft }))
                    setKeySaveErrors((e) => ({ ...e, [provider]: undefined }))
                  }}
                  saveErrors={keySaveErrors}
                />
                {secureStorageAvailable === false && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    Secure storage is unavailable on this system. Your API keys cannot be saved and will need to be re-entered each session.
                  </p>
                )}
              </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="emojiIcons">Emoji Tab Icons</Label>
                <p className="text-xs text-muted-foreground">
                  Show AI-generated emoji icons on all tabs. Uses your Anthropic key (Claude Haiku), whichever provider chat uses.
                </p>
              </div>
              <Switch
                id="emojiIcons"
                checked={settings.llm.emojiIcons ?? false}
                onCheckedChange={(checked) => setLLMConfig({ emojiIcons: checked })}
                disabled={!settings.llm.keyStatus?.anthropic}
              />
            </div>
            </div>{/* end AI features wrapper */}

          </TabsContent>

          {!isMas && (
          <TabsContent value="integrations" className="space-y-4 mt-4 overflow-y-auto flex-1 px-1 -mx-1" ref={integrationsTabRef}>
            {!isWebMode() && <McpIntegration />}
            {!isWebMode() && <Separator />}
            {!isWebMode() && <McpConnections />}
            {!isWebMode() && <Separator />}
            {!isWebMode() && <RemoteAccess />}
            {!isWebMode() && <Separator />}
            {!isWebMode() && <ProseSkillIntegration />}
            {!isWebMode() && <Separator />}
            {!isWebMode() && (
              <RemarkableIntegration
                settings={settings}
                setRemarkableConfig={setRemarkableConfig}
              />
            )}
            {/* All three integrations (Mcp, ProseSkill, Remarkable) are desktop
                only — without this fallback, web users land on a completely empty
                Integrations tab with no explanation. MAS builds get no
                Integrations tab at all (#1222). */}
            {isWebMode() && (
              <p className="text-sm text-muted-foreground">
                No integrations are available in this build.
              </p>
            )}
          </TabsContent>
          )}

          {!isMas && (
          <TabsContent value="account" className="space-y-4 mt-4 overflow-y-auto flex-1 px-1 -mx-1" ref={accountTabRef}>
            <AccountSection />
          </TabsContent>
          )}
        </Tabs>

        <Separator className="my-4 shrink-0" />

        <div className="flex justify-end gap-2 shrink-0">
          <Button variant="outline" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={anyDraftInvalid}>Save Changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
