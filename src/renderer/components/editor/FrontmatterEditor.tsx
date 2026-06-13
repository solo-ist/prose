import { useState, useCallback, useEffect, useRef } from 'react'
import * as yaml from 'js-yaml'
import { Lock, Plus, X, ChevronDown, ChevronUp, Check } from 'lucide-react'
import { Input } from '../ui/input'
import { useEditorStore } from '../../stores/editorStore'

const PROTECTED_FIELDS = new Set(['google_doc_id', 'google_synced_at'])

interface Field {
  key: string
  value: string
  readonly: boolean
  originalValue: unknown
}

interface FrontmatterEditorProps {
  frontmatter: Record<string, unknown>
  onSave: (frontmatter: Record<string, unknown>) => void
}

function frontmatterToFields(frontmatter: Record<string, unknown>): Field[] {
  return Object.entries(frontmatter).map(([key, value]) => {
    const isSimple = typeof value === 'string' || value === null || value === undefined
    return {
      key,
      value: isSimple ? String(value ?? '') : JSON.stringify(value),
      readonly: !isSimple,
      originalValue: value
    }
  })
}

function fieldsToFrontmatter(fields: Field[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const { key, value, readonly: isReadonly, originalValue } of fields) {
    if (key.trim()) result[key.trim()] = isReadonly ? originalValue : value
  }
  return result
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  if (Object.keys(frontmatter).length === 0) return ''
  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, quotingType: '"', forceQuotes: false })
  return `---\n${yamlStr}---\n`
}

export function FrontmatterEditor({ frontmatter, onSave }: FrontmatterEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [fields, setFields] = useState<Field[]>(() => frontmatterToFields(frontmatter))
  const pendingFrontmatter = useEditorStore((state) => state.pendingFrontmatter)
  const rejectPendingFrontmatter = useEditorStore((state) => state.rejectPendingFrontmatter)
  const setStoredFrontmatter = useEditorStore((state) => state.setFrontmatter)

  // Track whether the next prop change originated from our own onSave round-trip
  // so we don't clobber an in-progress local edit when the store echoes back.
  const skipNextPropSyncRef = useRef(false)

  // Per-row input refs so Enter can advance focus through key/value fields.
  const keyRefs = useRef<(HTMLInputElement | null)[]>([])
  const valueRefs = useRef<(HTMLInputElement | null)[]>([])
  // When Enter appends a new row, remember where to move focus once it renders.
  const pendingFocusRef = useRef<{ index: number; field: 'key' | 'value' } | null>(null)

  // Sync local fields when the frontmatter prop changes from outside this
  // component (e.g., AI-applied frontmatter via MCP suggest_edit). User-initiated
  // edits set the skip flag so we don't re-init on the round-trip.
  useEffect(() => {
    if (skipNextPropSyncRef.current) {
      skipNextPropSyncRef.current = false
      return
    }
    setFields(frontmatterToFields(frontmatter))
  }, [frontmatter])

  const handleFieldChange = useCallback((index: number, field: Partial<Field>) => {
    setFields(prev => {
      const next = prev.map((f, i) => i === index ? { ...f, ...field } : f)
      skipNextPropSyncRef.current = true
      onSave(fieldsToFrontmatter(next))
      return next
    })
  }, [onSave])

  const handleDelete = useCallback((index: number) => {
    setFields(prev => {
      const next = prev.filter((_, i) => i !== index)
      skipNextPropSyncRef.current = true
      onSave(fieldsToFrontmatter(next))
      return next
    })
  }, [onSave])

  const handleAdd = useCallback(() => {
    setFields(prev => [...prev, { key: '', value: '', readonly: false, originalValue: '' }])
  }, [])

  // Move focus to a freshly-appended row once React has rendered it.
  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null
    const target = pending.field === 'key' ? keyRefs.current[pending.index] : valueRefs.current[pending.index]
    target?.focus()
  }, [fields])

  // Enter commits the current field and advances focus; Escape collapses the editor.
  // Persistence is unchanged — saves still happen per keystroke via handleFieldChange.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, index: number, which: 'key' | 'value') => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setIsExpanded(false)
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (which === 'key') {
      // Return in a key field focuses that row's value field.
      valueRefs.current[index]?.focus()
      return
    }
    // Return in a value field.
    if (index < fields.length - 1) {
      // Advance to the next row's key input.
      keyRefs.current[index + 1]?.focus()
      return
    }
    const row = fields[index]
    if (!row.key.trim() && !row.value.trim()) {
      // Return on an empty trailing field collapses the editor.
      setIsExpanded(false)
      return
    }
    // Append a new blank row and focus its key input once it renders.
    pendingFocusRef.current = { index: fields.length, field: 'key' }
    handleAdd()
  }, [fields, handleAdd])

  // Accept handler: write the accepted frontmatter directly to the store FIRST
  // as a durable fallback, then call onSave to reserialize body content (which
  // no-ops if the TipTap editor isn't mounted), then clear the pending state.
  // The direct store write guarantees the user's accept can't be silently
  // dropped even if onSave's editor-dependent code path is unavailable.
  const handleAcceptPending = useCallback(() => {
    if (!pendingFrontmatter) return
    const accepted = pendingFrontmatter
    setStoredFrontmatter(accepted)
    setFields(frontmatterToFields(accepted))
    onSave(accepted)
    rejectPendingFrontmatter()
  }, [pendingFrontmatter, setStoredFrontmatter, rejectPendingFrontmatter, onSave])

  if (Object.keys(frontmatter).length === 0 && fields.length === 0 && !pendingFrontmatter) {
    return (
      <button
        className="mb-6 flex items-center gap-1 text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors text-xs font-mono"
        onClick={() => {
          handleAdd()
          setIsExpanded(true)
        }}
        title="Add frontmatter to this document"
      >
        <Plus className="w-3 h-3" />
        Add frontmatter
      </button>
    )
  }

  // Pending frontmatter overlay — shown when AI proposes frontmatter changes via suggest_edit
  if (pendingFrontmatter) {
    const pendingFields = frontmatterToFields(pendingFrontmatter)
    return (
      <div className="mb-6 rounded-md border px-4 py-3 font-mono text-xs frontmatter-pending-overlay">
        <div className="flex items-center justify-between mb-2">
          <span className="frontmatter-pending-label">AI suggested frontmatter</span>
          <div className="flex items-center gap-2">
            <button
              className="frontmatter-pending-accept-btn"
              onClick={handleAcceptPending}
              title="Accept frontmatter suggestion"
            >
              <Check className="w-3 h-3" />
              Accept
            </button>
            <button
              className="frontmatter-pending-reject-btn"
              onClick={rejectPendingFrontmatter}
              title="Reject frontmatter suggestion"
            >
              <X className="w-3 h-3" />
              Reject
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          {pendingFields.map(({ key, value }) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-muted-foreground/70 shrink-0 w-32 truncate">{key}</span>
              <span className="text-muted-foreground/40 shrink-0">:</span>
              <span className="flex-1 truncate frontmatter-pending-value">{value}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Collapsed view
  if (!isExpanded) {
    // Hide empty-key rows in the collapsed display — they're an in-progress
    // editing state, not content worth showing. If nothing remains, fall back
    // to the "+ Add frontmatter" affordance so the user can recover from
    // adding-then-collapsing-without-typing. (pendingFrontmatter is unreachable
    // here — the pending overlay branch above returns earlier.)
    const displayFields = fields.filter(f => f.key.trim())
    if (displayFields.length === 0) {
      return (
        <button
          className="mb-6 flex items-center gap-1 text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors text-xs font-mono"
          onClick={() => {
            setFields(prev => prev.filter(f => f.key.trim()))
            handleAdd()
            setIsExpanded(true)
          }}
          title="Add frontmatter to this document"
        >
          <Plus className="w-3 h-3" />
          Add frontmatter
        </button>
      )
    }
    return (
      <div
        className="mb-6 rounded-md bg-muted/50 border border-border/50 px-4 py-3 font-mono text-xs text-muted-foreground cursor-pointer hover:bg-muted/70 transition-colors group"
        onClick={() => setIsExpanded(true)}
        title="Click to edit frontmatter"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5 flex-1 min-w-0">
            {displayFields.map(({ key, value }) => {
              const isDocId = key === 'google_doc_id'
              const displayValue = isDocId ? value.replace(/^['"]|['"]$/g, '') : value
              return (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="text-muted-foreground/70 shrink-0 w-32 truncate">{key}</span>
                  <span className="text-muted-foreground/40 shrink-0">:</span>
                  {isDocId ? (
                    <a
                      href={`https://docs.google.com/document/d/${displayValue}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground/80 flex-1 truncate underline decoration-muted-foreground/40 hover:decoration-foreground/60"
                      onClick={e => e.stopPropagation()}
                    >
                      {displayValue}
                    </a>
                  ) : (
                    <span className="text-foreground/80 flex-1 truncate">{displayValue}</span>
                  )}
                </div>
              )
            })}
          </div>
          <ChevronDown className="w-3 h-3 shrink-0 mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity" />
        </div>
      </div>
    )
  }

  // Expanded editable view
  return (
    <div className="mb-6 rounded-md bg-muted/50 border border-border/50 px-4 py-3 font-mono text-xs">
      <div className="flex items-center justify-between mb-3">
        <span className="text-muted-foreground/70 text-xs">Frontmatter</span>
        <button
          className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          onClick={() => setIsExpanded(false)}
          title="Collapse"
        >
          <ChevronUp className="w-3 h-3" />
        </button>
      </div>
      <div className="space-y-1.5">
        {fields.map((field, index) => {
          const isProtected = PROTECTED_FIELDS.has(field.key)
          const isDisabled = isProtected || field.readonly
          return (
            <div key={index} className="flex items-center gap-1.5">
              <Input
                ref={el => { keyRefs.current[index] = el }}
                value={field.key}
                onChange={e => handleFieldChange(index, { key: e.target.value })}
                onKeyDown={e => handleKeyDown(e, index, 'key')}
                placeholder="key"
                disabled={isDisabled}
                className="h-6 px-2 py-0 text-xs font-mono w-32 shrink-0 bg-background/50 border-border/50 disabled:opacity-60 disabled:cursor-default"
              />
              <span className="text-muted-foreground/40 shrink-0">:</span>
              <Input
                ref={el => { valueRefs.current[index] = el }}
                value={field.value}
                onChange={e => handleFieldChange(index, { value: e.target.value })}
                onKeyDown={e => handleKeyDown(e, index, 'value')}
                placeholder="value"
                disabled={isDisabled}
                className="h-6 px-2 py-0 text-xs font-mono flex-1 bg-background/50 border-border/50 disabled:opacity-60 disabled:cursor-default"
              />
              {isProtected || field.readonly ? (
                <Lock className="w-3 h-3 text-muted-foreground/40 shrink-0" aria-label="Protected field" />
              ) : (
                <button
                  className="text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors shrink-0"
                  onClick={() => handleDelete(index)}
                  title="Delete field"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button
        className="mt-2 flex items-center gap-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors text-xs"
        onClick={handleAdd}
      >
        <Plus className="w-3 h-3" />
        Add field
      </button>
    </div>
  )
}
