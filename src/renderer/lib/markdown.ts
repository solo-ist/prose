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
