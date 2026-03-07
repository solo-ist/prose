import { useState, useCallback } from 'react'
import * as yaml from 'js-yaml'
import { Lock, Plus, X, ChevronDown, ChevronUp } from 'lucide-react'
import { Input } from '../ui/input'

const PROTECTED_FIELDS = new Set(['google_doc_id', 'google_synced_at'])

interface Field {
  key: string
  value: string
}

interface FrontmatterEditorProps {
  frontmatter: Record<string, unknown>
  onSave: (frontmatter: Record<string, unknown>) => void
}

function frontmatterToFields(frontmatter: Record<string, unknown>): Field[] {
  return Object.entries(frontmatter).map(([key, value]) => ({
    key,
    value: String(value ?? '')
  }))
}

function fieldsToFrontmatter(fields: Field[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const { key, value } of fields) {
    if (key.trim()) result[key.trim()] = value
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

  const handleFieldChange = useCallback((index: number, field: Partial<Field>) => {
    setFields(prev => {
      const next = prev.map((f, i) => i === index ? { ...f, ...field } : f)
      onSave(fieldsToFrontmatter(next))
      return next
    })
  }, [onSave])

  const handleDelete = useCallback((index: number) => {
    setFields(prev => {
      const next = prev.filter((_, i) => i !== index)
      onSave(fieldsToFrontmatter(next))
      return next
    })
  }, [onSave])

  const handleAdd = useCallback(() => {
    setFields(prev => [...prev, { key: '', value: '' }])
  }, [])

  if (Object.keys(frontmatter).length === 0 && fields.length === 0) return null

  // Collapsed view
  if (!isExpanded) {
    return (
      <div
        className="mb-6 rounded-md bg-muted/50 border border-border/50 px-4 py-3 font-mono text-xs text-muted-foreground cursor-pointer hover:bg-muted/70 transition-colors group"
        onClick={() => setIsExpanded(true)}
        title="Click to edit frontmatter"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5 flex-1 min-w-0">
            {fields.map(({ key, value }) => {
              const isDocId = key === 'google_doc_id'
              const displayValue = isDocId ? value.replace(/^['"]|['"]$/g, '') : value
              return (
                <div key={key} className="flex gap-2">
                  <span className="text-muted-foreground/70 shrink-0">{key}:</span>
                  {isDocId ? (
                    <a
                      href={`https://docs.google.com/document/d/${displayValue}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground/80 break-all underline decoration-muted-foreground/40 hover:decoration-foreground/60"
                      onClick={e => e.stopPropagation()}
                    >
                      {displayValue}
                    </a>
                  ) : (
                    <span className="text-foreground/80 break-all">{value}</span>
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
          return (
            <div key={index} className="flex items-center gap-1.5">
              <Input
                value={field.key}
                onChange={e => handleFieldChange(index, { key: e.target.value })}
                placeholder="key"
                disabled={isProtected}
                className="h-6 px-2 py-0 text-xs font-mono w-32 shrink-0 bg-background/50 border-border/50 disabled:opacity-60 disabled:cursor-default"
              />
              <span className="text-muted-foreground/40 shrink-0">:</span>
              <Input
                value={field.value}
                onChange={e => handleFieldChange(index, { value: e.target.value })}
                placeholder="value"
                disabled={isProtected}
                className="h-6 px-2 py-0 text-xs font-mono flex-1 bg-background/50 border-border/50 disabled:opacity-60 disabled:cursor-default"
              />
              {isProtected ? (
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
