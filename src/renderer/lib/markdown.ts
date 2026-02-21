import yaml from 'js-yaml'

export interface ParsedMarkdown {
  content: string
  frontmatter: Record<string, unknown>
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseMarkdown(raw: string): ParsedMarkdown {
  try {
    const match = raw.match(FRONTMATTER_REGEX)
    if (!match) {
      return { content: raw, frontmatter: {} }
    }

    const parsed = yaml.load(match[1])
    const frontmatter = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    const content = raw.slice(match[0].length).trim()

    return { content, frontmatter }
  } catch {
    return { content: raw, frontmatter: {} }
  }
}

export function serializeMarkdown(content: string, frontmatter: Record<string, unknown>): string {
  if (Object.keys(frontmatter).length === 0) {
    return content
  }

  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1 }).trimEnd()
  return `---\n${yamlStr}\n---\n${content}`
}

export function hasFrontmatter(raw: string): boolean {
  return raw.trimStart().startsWith('---')
}

/**
 * Extract the text of the first H1 heading from markdown content.
 * Skips frontmatter if present. Returns null if no H1 is found.
 */
export function extractFirstH1(content: string): string | null {
  // Skip frontmatter block if present
  let text = content
  const fmMatch = text.match(FRONTMATTER_REGEX)
  if (fmMatch) {
    text = text.slice(fmMatch[0].length)
  }
  // Strip fenced code blocks to avoid matching `# comment` inside them
  text = text.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?\n\1\s*$/gm, '')
  // Match the first ATX H1 heading: a line starting with exactly one `#`
  const match = text.match(/^#[ \t]+(.+)$/m)
  if (!match) return null
  // Strip trailing heading markers (e.g., "# Title #") and trim
  return match[1].replace(/\s+#+\s*$/, '').trim() || null
}
