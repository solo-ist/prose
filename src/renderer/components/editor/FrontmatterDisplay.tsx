import { useMemo } from 'react'

interface FrontmatterDisplayProps {
  content: string
}

interface ParsedFrontmatter {
  data: Record<string, string>
  bodyStart: number
}

function parseFrontmatter(content: string): ParsedFrontmatter | null {
  if (!content.startsWith('---')) return null

  const endIndex = content.indexOf('\n---', 3)
  if (endIndex === -1) return null

  const frontmatterContent = content.slice(4, endIndex).trim()
  const data: Record<string, string> = {}

  for (const line of frontmatterContent.split('\n')) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue
    const key = line.slice(0, colonIndex).trim()
    const value = line.slice(colonIndex + 1).trim()
    if (key) data[key] = value
  }

  // bodyStart is after the closing --- and any following newlines
  const bodyStart = endIndex + 4
  return { data, bodyStart }
}

export function FrontmatterDisplay({ content }: FrontmatterDisplayProps) {
  const frontmatter = useMemo(() => parseFrontmatter(content), [content])

  if (!frontmatter || Object.keys(frontmatter.data).length === 0) {
    return null
  }

  const { data } = frontmatter

  return (
    <div className="mb-6 rounded-md bg-muted/50 border border-border/50 px-4 py-3 font-mono text-xs text-muted-foreground">
      <div className="space-y-0.5">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex">
            <span className="text-muted-foreground/70 w-20 shrink-0">{key}:</span>
            <span className="text-foreground/80">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function getContentWithoutFrontmatter(content: string): string {
  const frontmatter = parseFrontmatter(content)
  if (!frontmatter) return content
  return content.slice(frontmatter.bodyStart).replace(/^\n+/, '')
}

export function hasFrontmatter(content: string): boolean {
  return parseFrontmatter(content) !== null
}

export function getFrontmatterRaw(content: string): string {
  if (!content.startsWith('---')) return ''
  const endIndex = content.indexOf('\n---', 3)
  if (endIndex === -1) return ''
  // Return the frontmatter including closing --- and trailing newline
  return content.slice(0, endIndex + 4) + '\n'
}
