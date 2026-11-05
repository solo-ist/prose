/**
 * First-run onboarding (#1188): one multi-step modal in place of the AI
 * consent dialog, its Skill step and the default-handler prompt. Design of
 * record: docs/issues/1188/design/ (README has the flow table and the rules).
 *
 * Rules: the AI choice is explicit (Continue waits for a card; Escape is inert
 * until then); every later step is skippable; answers are held here and
 * written together at Done; side effects (key save, Skill download, MCP
 * install) run when their button is pressed and Back never undoes them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Download, FileText, KeyRound, PenLine, Plug, Sparkles } from 'lucide-react'
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../ui/alert-dialog'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { ProseMark } from '../ProseMark'
import { useSettingsStore } from '../../stores/settingsStore'
import { validateApiKeyFormat } from '../../lib/llm'
import { cn } from '../../lib/utils'
import {
  STEP_LABELS,
  resolveStep,
  sequenceFor,
  summaryRows,
  type AiChoice,
  type DefaultChoice,
  type SideEffect,
  type StepId
} from './steps'

export type OnboardingFinish = 'new' | 'open' | 'close'

interface OnboardingDialogProps {
  open: boolean
  /** `'ai'` re-enters an existing user at the AI step (a bumped consent version, the Settings toggle). */
  startAt: 'welcome' | 'ai'
  onFinish: (action: OnboardingFinish) => void
}

const ACCEPT = 'hsl(140 60% 55%)'
const REJECT = 'hsl(0 70% 62%)'
const AI_VIOLET = 'hsl(270 70% 60%)'
const SERIF = { fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic', fontWeight: 500 } as const
const KEYS_URL = 'https://console.anthropic.com/settings/keys'

type KeyState = 'empty' | 'checking' | 'valid' | 'invalid'

interface Probe {
  direct: boolean
  defaultAlready: boolean
  mcpInstalled: boolean
}

/** What the environment decides for the sequence; unknown answers count as "not". */
async function probeEnvironment(): Promise<Probe> {
  const api = window.api
  const direct = api?.isMasBuild !== true
  let defaultAlready = false
  let mcpInstalled = false
  try {
    defaultAlready = (await api?.fileAssociationIsDefault?.()) === true
  } catch {
    // Unknown counts as not default, as the old prompt did.
  }
  if (direct) {
    try {
      mcpInstalled = (await api?.mcpGetStatus?.())?.installed === true
    } catch {
      // Not installed.
    }
  }
  return { direct, defaultAlready, mcpInstalled }
}

const TONE_CLASS = {
  foreground: 'text-foreground',
  muted: 'text-muted-foreground',
  accept: ''
} as const

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">{children}</kbd>
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{children}</code>
}

function Tile({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-muted">
      {children}
    </span>
  )
}

export function OnboardingDialog({ open, startAt, onFinish }: OnboardingDialogProps) {
  const settings = useSettingsStore((s) => s.settings)
  const setAIConsent = useSettingsStore((s) => s.setAIConsent)
  const setErrorTracking = useSettingsStore((s) => s.setErrorTracking)
  const setFileAssociationConfig = useSettingsStore((s) => s.setFileAssociationConfig)
  const setLLMConfig = useSettingsStore((s) => s.setLLMConfig)
  const saveSettings = useSettingsStore((s) => s.saveSettings)

  const [probe, setProbe] = useState<Probe | null>(null)
  const [step, setStep] = useState<StepId>(startAt)
  const [ai, setAi] = useState<AiChoice>(null)
  const [crash, setCrash] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [keyState, setKeyState] = useState<KeyState>('empty')
  const [keyMessage, setKeyMessage] = useState<string | null>(null)
  const [keySaved, setKeySaved] = useState(false)
  const [skill, setSkill] = useState<SideEffect>('idle')
  const [skillError, setSkillError] = useState<string | null>(null)
  const [mcp, setMcp] = useState<SideEffect>('idle')
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [def, setDef] = useState<DefaultChoice>(null)

  // Start clean on every open (a re-entry from Settings or a bumped consent
  // version), seeded from what the user already has: the crash setting and
  // a key already in the Keychain.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const hasKey = !!settings.llm.apiKey
    setProbe(null)
    setStep(startAt)
    setAi(null)
    setCrash(settings.errorTracking?.enabled === true)
    setKeyInput('')
    setKeyState(hasKey ? 'valid' : 'empty')
    setKeySaved(hasKey)
    setKeyMessage(hasKey ? 'A key is already in the Keychain.' : null)
    setSkill('idle')
    setSkillError(null)
    setMcp('idle')
    setMcpError(null)
    setDef(null)
    probeEnvironment().then((p) => {
      if (cancelled) return
      setProbe(p)
      if (p.mcpInstalled) setMcp('done')
    })
    return () => {
      cancelled = true
    }
    // The seeds are read once per open on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startAt])

  const direct = probe ? probe.direct : window.api?.isMasBuild !== true
  const defaultAlready = probe?.defaultAlready ?? false
  const seq = useMemo(() => sequenceFor({ ai, direct, defaultAlready }), [ai, direct, defaultAlready])
  const current = resolveStep(seq, step)
  const idx = seq.indexOf(current)
  const total = seq.length

  const next = () => {
    const to = seq[idx + 1]
    if (to) setStep(to)
  }
  const back = () => {
    const to = seq[idx - 1]
    if (to) setStep(to)
  }

  const finish = useCallback(
    (action: OnboardingFinish) => {
      // Done is unreachable without the AI choice; the guard keeps the write explicit.
      if (ai === null) return
      setAIConsent(ai === 'ai')
      setErrorTracking(crash)
      if (def === 'done' || defaultAlready) setFileAssociationConfig({ hasBeenPrompted: true })
      onFinish(action)
    },
    [ai, crash, def, defaultAlready, setAIConsent, setErrorTracking, setFileAssociationConfig, onFinish]
  )

  const verifyKey = async () => {
    const value = keyInput.trim()
    const formatError = validateApiKeyFormat('anthropic', value)
    if (formatError) {
      setKeyState('invalid')
      setKeyMessage(formatError)
      return
    }
    setKeyState('checking')
    setKeyMessage(null)
    try {
      const result = window.api?.testApiKey
        ? await window.api.testApiKey({ provider: 'anthropic', apiKey: value })
        : { success: false, message: 'The key check is unavailable in this build.' }
      if (!result.success) {
        setKeyState('invalid')
        setKeyMessage(result.message || 'Anthropic did not accept this key.')
        return
      }
      // The Settings path: the store holds it until settings:save moves it to the Keychain.
      setLLMConfig({ provider: 'anthropic', apiKey: value })
      await saveSettings()
      setKeyState('valid')
      setKeySaved(true)
      setKeyMessage('Key works. Saved to Keychain.')
    } catch (e) {
      setKeyState('invalid')
      setKeyMessage(e instanceof Error ? e.message : 'The key check failed.')
    }
  }

  const runSkill = async () => {
    if (skill === 'working' || skill === 'done') return
    setSkill('working')
    setSkillError(null)
    try {
      const result = await window.api?.downloadSkill?.()
      if (result?.success) setSkill('done')
      else {
        setSkill('error')
        setSkillError(result?.error ?? 'Download failed')
      }
    } catch (e) {
      setSkill('error')
      setSkillError(e instanceof Error ? e.message : 'Download failed')
    }
  }

  const runMcp = async () => {
    if (mcp === 'working' || mcp === 'done') return
    setMcp('working')
    setMcpError(null)
    try {
      const result = await window.api?.mcpInstall?.()
      if (result?.success) setMcp('done')
      else {
        setMcp('error')
        setMcpError(result?.error ?? 'Install failed')
      }
    } catch (e) {
      setMcp('error')
      setMcpError(e instanceof Error ? e.message : 'Install failed')
    }
  }

  // Escape: inert until the AI choice is made; then "skip to Done"; on Done it finishes.
  const onEscape = (event: KeyboardEvent) => {
    event.preventDefault()
    if (ai === null) return
    if (current === 'done') finish('close')
    else setStep('done')
  }

  let primaryLabel = 'Continue'
  let primaryDisabled = false
  let onPrimary: () => void = next
  let secondaryLabel: string | null = null
  let onSecondary: () => void = next
  switch (current) {
    case 'welcome':
      primaryLabel = 'Get started'
      break
    case 'ai':
      primaryDisabled = ai === null
      break
    case 'key':
      primaryDisabled = keyState !== 'valid'
      secondaryLabel = 'Skip for now'
      break
    case 'claude':
      if (skill !== 'done' && mcp !== 'done') primaryLabel = 'Skip for now'
      break
    case 'default':
      secondaryLabel = 'Remind me later'
      onSecondary = () => {
        setDef('later')
        next()
      }
      onPrimary = () => {
        setDef('done')
        next()
      }
      break
    case 'done':
      primaryLabel = 'New document'
      secondaryLabel = 'Open file…'
      onPrimary = () => finish('new')
      onSecondary = () => finish('open')
      break
  }

  const summary = summaryRows({ ai, keySaved, crash, direct, skill, mcp, def, defaultAlready })
  const sideEffectLabel = (state: SideEffect, idle: string, working: string, done: string) =>
    state === 'done' ? done : state === 'working' ? working : state === 'error' ? 'Retry' : idle

  const title = (text: string, serif = false) => (
    <AlertDialogTitle
      className={cn(
        'm-0',
        serif
          ? 'text-[32px] leading-[1.1] tracking-[-0.01em] text-foreground dark:text-[#e2d9cb]'
          : 'text-lg font-semibold leading-[1.3]'
      )}
      style={serif ? SERIF : undefined}
    >
      {text}
    </AlertDialogTitle>
  )

  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        data-testid="onboarding"
        aria-describedby={undefined}
        onEscapeKeyDown={onEscape}
        className="flex h-[560px] max-h-[calc(100vh-2rem)] w-[520px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-lg p-0 text-[13px]"
      >
        <div className="flex flex-col gap-3 px-6 pt-5">
          <div className="flex items-center justify-between">
            <span
              data-testid="onboarding-progress"
              className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground"
            >
              {idx + 1} / {total} · {STEP_LABELS[current]}
            </span>
            {!direct && <span className="text-[11px] text-muted-foreground">App Store build</span>}
          </div>
          <div aria-hidden="true" className="flex gap-1">
            {seq.map((id, i) => (
              <div key={id} className={cn('h-0.5 flex-1 rounded-full', i <= idx ? 'bg-foreground' : 'bg-border')} />
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-7">
          {current === 'welcome' && (
            <div className="flex flex-col gap-6">
              <ProseMark className="h-14 w-14 text-muted-foreground dark:text-[#e2d9cb]" />
              <div className="flex flex-col gap-2">
                <AlertDialogTitle
                  className="m-0 text-[36px] leading-[1.05] tracking-[-0.01em] text-foreground dark:text-[#e2d9cb]"
                  style={SERIF}
                >
                  Welcome to Prose.
                </AlertDialogTitle>
                <p className="m-0 text-sm text-muted-foreground">A free, open-source markdown editor for the AI era.</p>
              </div>
              <ul className="m-0 flex list-none flex-col gap-3.5 p-0 pt-1">
                <li className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
                  <span>
                    <span className="font-medium">Local first.</span>{' '}
                    <span className="text-muted-foreground">
                      Plain <Code>.md</Code> and <Code>.txt</Code> on disk.
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <PenLine className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
                  <span>
                    <span className="font-medium">Optional AI.</span>{' '}
                    <span className="text-muted-foreground">It doesn't strive to write for you.</span>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
                  <span>
                    <span className="font-medium">Quick setup.</span>{' '}
                    <span className="text-muted-foreground">Skip anything. Change it later in Settings.</span>
                  </span>
                </li>
              </ul>
            </div>
          )}

          {current === 'ai' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                {title('AI writing assistance')}
                <p className="m-0 text-muted-foreground">Choose how Prose works. You can switch any time in Settings.</p>
              </div>
              <div role="radiogroup" aria-label="AI features" className="flex flex-col gap-2">
                {(
                  [
                    {
                      value: 'ai' as const,
                      icon: <Sparkles className="h-4 w-4" style={{ color: AI_VIOLET }} aria-hidden="true" />,
                      name: 'Use AI',
                      text: 'When you ask, selected text and document content go to Anthropic on your own key. Directly, no middleman.'
                    },
                    {
                      value: 'none' as const,
                      icon: <PenLine className="h-4 w-4 text-muted-foreground" aria-hidden="true" />,
                      name: 'Write without AI',
                      text: 'A clean, fast, local-first editor on its own. AI stays off until you turn it on.'
                    }
                  ] as const
                ).map((card) => {
                  const checked = ai === card.value
                  return (
                    <button
                      key={card.value}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => setAi(card.value)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border p-3.5 text-left transition-colors',
                        checked ? 'border-foreground bg-muted/40' : 'border-border hover:bg-muted/20'
                      )}
                    >
                      <Tile>{card.icon}</Tile>
                      <span className="flex flex-1 flex-col gap-1">
                        <span className="font-medium">{card.name}</span>
                        <span className="text-xs leading-relaxed text-muted-foreground">{card.text}</span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border',
                          checked ? 'border-foreground' : 'border-muted-foreground/60'
                        )}
                      >
                        {checked && <span className="h-2 w-2 rounded-full bg-foreground" />}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="border-t border-border pt-4">
                <label htmlFor="onboarding-crash" className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    id="onboarding-crash"
                    checked={crash}
                    onCheckedChange={(value) => setCrash(value === true)}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">Send anonymous crash reports</span>
                    <span className="text-xs text-muted-foreground">
                      Stack traces only. No document content, ever. Settings → General.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {current === 'key' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                {title('Add your Anthropic key')}
                <p className="m-0 text-muted-foreground">
                  Prose uses your own key. It's kept in the macOS Keychain and only ever sent to Anthropic.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="onboarding-key" className="text-xs font-medium">
                  API key
                </label>
                <div className="flex gap-2">
                  <Input
                    id="onboarding-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={keySaved && !keyInput ? '•••• key in Keychain' : 'sk-ant-…'}
                    value={keyInput}
                    onChange={(e) => {
                      setKeyInput(e.target.value)
                      setKeyState('empty')
                      setKeyMessage(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void verifyKey()
                    }}
                    className="h-9"
                    style={{
                      borderColor:
                        keyState === 'invalid' ? REJECT : keyState === 'valid' ? ACCEPT : undefined
                    }}
                  />
                  <Button
                    variant="outline"
                    className="h-9 flex-none"
                    onClick={() => void verifyKey()}
                    disabled={keyState === 'checking' || !keyInput.trim()}
                  >
                    {keyState === 'checking' ? 'Checking…' : 'Verify'}
                  </Button>
                </div>
                <div aria-live="polite" className="flex min-h-5 items-start gap-2 text-xs">
                  {keyState === 'checking' && <span className="text-muted-foreground">Checking with Anthropic…</span>}
                  {keyState === 'valid' && (
                    <>
                      <Check className="mt-px h-3.5 w-3.5 flex-none" style={{ color: ACCEPT }} aria-hidden="true" />
                      <span style={{ color: ACCEPT }}>{keyMessage ?? 'Key works. Saved to Keychain.'}</span>
                    </>
                  )}
                  {keyState === 'invalid' && <span style={{ color: REJECT }}>{keyMessage}</span>}
                  {keyState === 'empty' && (
                    <span className="text-muted-foreground">
                      Starts with <Code>sk-ant-</Code>. Create one at{' '}
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => void window.api?.openExternal?.(KEYS_URL)}
                      >
                        console.anthropic.com
                      </button>
                      .
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3.5 py-3">
                <KeyRound className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
                <span className="text-xs text-muted-foreground">
                  No key yet? Skip this. The assistant waits until you add one in Settings → AI <Kbd>⌘,</Kbd>
                </span>
              </div>
            </div>
          )}

          {current === 'claude' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                {title('Connect Claude')}
                <p className="m-0 text-muted-foreground">Optional. Both live in Settings → Integrations too.</p>
              </div>
              <div className="flex flex-col rounded-lg border border-border">
                <div className="flex items-start gap-3 p-4">
                  <Tile>
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </Tile>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium">Claude Skill</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      Teaches Claude to outline, read and propose edits to Prose documents. Upload it on claude.ai
                      under Customize → Skills.
                    </span>
                    {skillError && <span className="text-xs" style={{ color: REJECT }}>{skillError}</span>}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 flex-none gap-1.5"
                    style={skill === 'done' ? { color: ACCEPT } : undefined}
                    onClick={() => void runSkill()}
                    disabled={skill === 'working' || skill === 'done'}
                  >
                    {skill === 'done' && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                    {sideEffectLabel(skill, 'Download', 'Downloading…', 'Downloaded')}
                  </Button>
                </div>
                <div className="h-px bg-border" />
                <div className="flex items-start gap-3 p-4">
                  <Tile>
                    <Plug className="h-4 w-4" aria-hidden="true" />
                  </Tile>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium">Claude Desktop</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      Adds the Prose MCP server, so Claude Desktop can read and edit the document you have open.
                    </span>
                    {mcpError && <span className="text-xs" style={{ color: REJECT }}>{mcpError}</span>}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 flex-none gap-1.5"
                    style={mcp === 'done' ? { color: ACCEPT } : undefined}
                    onClick={() => void runMcp()}
                    disabled={mcp === 'working' || mcp === 'done'}
                  >
                    {mcp === 'done' && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                    {sideEffectLabel(mcp, 'Install', 'Installing…', 'Installed')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {current === 'default' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                {title('Open .md files in Prose')}
                <p className="m-0 text-muted-foreground">
                  macOS doesn't let apps set this themselves. It's four clicks in Finder.
                </p>
              </div>
              <ol className="m-0 flex list-none flex-col rounded-lg border border-border p-0">
                {[
                  <>Right-click any <Code>.md</Code> file</>,
                  <>Get Info <Kbd>⌘I</Kbd></>,
                  <>Under Open with, pick Prose</>,
                  <>Click Change All…</>
                ].map((item, i) => (
                  <li
                    key={i}
                    className={cn('flex gap-3.5 px-4 py-3', i < 3 && 'border-b border-border')}
                  >
                    <span className="w-3 text-muted-foreground">{i + 1}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
              <p className="m-0 text-xs text-muted-foreground">
                Continue once it's set, or come back to it: Prose asks again next launch.
              </p>
            </div>
          )}

          {current === 'done' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                {title('Ready to write.', true)}
                <p className="m-0 text-muted-foreground">
                  Here's what you set. All of it lives in Settings <Kbd>⌘,</Kbd>
                </p>
              </div>
              <dl data-testid="onboarding-summary" className="m-0 flex flex-col rounded-lg border border-border">
                {summary.map((row, i) => (
                  <div
                    key={row.label}
                    className={cn('flex items-baseline gap-3 px-4 py-2.5', i > 0 && 'border-t border-border')}
                  >
                    <dt className="flex-1 text-xs text-muted-foreground">{row.label}</dt>
                    <dd
                      className={cn('m-0 text-right text-xs', TONE_CLASS[row.tone])}
                      style={row.tone === 'accept' ? { color: ACCEPT } : undefined}
                    >
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
                <span><Kbd>⌘T</Kbd> New</span>
                <span><Kbd>⌘O</Kbd> Open</span>
                <span><Kbd>⇧⌘L</Kbd> Chat</span>
                <span><Kbd>⇧⌘H</Kbd> Files</span>
                <span><Kbd>F1</Kbd> All shortcuts</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-6 py-3.5">
          {idx > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={back}
              data-testid="onboarding-back"
              className="h-9 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
          )}
          <div className="flex-1" />
          {secondaryLabel && (
            <Button variant="outline" onClick={onSecondary} data-testid="onboarding-secondary" className="h-9">
              {secondaryLabel}
            </Button>
          )}
          <Button onClick={onPrimary} disabled={primaryDisabled} data-testid="onboarding-primary" className="h-9">
            {primaryLabel}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
