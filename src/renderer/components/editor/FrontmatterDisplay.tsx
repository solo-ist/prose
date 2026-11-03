import { useMemo } from 'react'

interface FrontmatterDisplayProps {
  /** The tab's frontmatter object (#1151); nothing is parsed from the body. */
  frontmatter?: Record<string, unknown>
}

/** The read-only frontmatter block of a preview or reMarkable tab. */
export function FrontmatterDisplay({ frontmatter }: FrontmatterDisplayProps) {
  const data = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(frontmatter ?? {})) {
      out[key] = String(value ?? '')
    }
    return out
  }, [frontmatter])

  if (Object.keys(data).length === 0) return null

  return (
    <div className="mb-6 rounded-md bg-muted/50 border border-border/50 px-4 py-3 font-mono text-xs text-muted-foreground">
      <div className="space-y-1.5">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="text-muted-foreground/70 shrink-0 w-32 truncate">{key}</span>
            <span className="text-muted-foreground/40 shrink-0">:</span>
            <span className="text-foreground/80 flex-1 truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
