import matter from 'gray-matter'

export interface ParsedMarkdown {
  content: string
  frontmatter: Record<string, unknown>
}

export function parseMarkdown(raw: string): ParsedMarkdown {
  try {
    const { content, data } = matter(raw)
    return {
      content: content.trim(),
      frontmatter: data
    }
  } catch {
    return {
      content: raw,
      frontmatter: {}
    }
  }
}

export function serializeMarkdown(content: string, frontmatter: Record<string, unknown>): string {
  if (Object.keys(frontmatter).length === 0) {
    return content
  }

  return matter.stringify(content, frontmatter)
}

export function hasFrontmatter(raw: string): boolean {
  return raw.trimStart().startsWith('---')
}
