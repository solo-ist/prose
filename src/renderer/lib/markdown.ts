import * as yaml from 'js-yaml'

/**
 * The YAML schema for frontmatter: js-yaml's default set without the YAML 1.1
 * `timestamp` type (#862). With it, `date: 2026-09-04` loads as a JS `Date`
 * and is written back as `2026-09-04T00:00:00.000Z` on every save (and the
 * non-string value locks the row in the frontmatter panel). Without it a date
 * is the text it was written as, and `dump` leaves it bare because nothing in
 * this schema would read it as another type. Every other default type stays.
 */
const TIMESTAMP_TAG = 'tag:yaml.org,2002:timestamp'
// A schema instance carries the type lists it was extended with; the typings
// stop at the constructor, so the default schema is read through a local shape.
const defaults = yaml.DEFAULT_SCHEMA as unknown as { implicit: Array<yaml.Type & { tag: string }>; explicit: yaml.Type[] }
export const FRONTMATTER_YAML_SCHEMA = new yaml.Schema({
  implicit: defaults.implicit.filter((type) => type.tag !== TIMESTAMP_TAG),
  explicit: defaults.explicit
})

/** Parse YAML the way frontmatter is parsed everywhere (the file, the model's payload). Throws on malformed YAML. */
export function loadFrontmatterYaml(text: string): unknown {
  return yaml.load(text, { schema: FRONTMATTER_YAML_SCHEMA })
}

/** Serialize frontmatter YAML with the same schema, so what was loaded writes back as it was. */
export function dumpFrontmatterYaml(value: unknown, options: Omit<yaml.DumpOptions, 'schema'> = {}): string {
  return yaml.dump(value, { lineWidth: -1, ...options, schema: FRONTMATTER_YAML_SCHEMA })
}

export interface ParsedMarkdown {
  content: string
  frontmatter: Record<string, unknown>
}

/**
 * Matches a complete ---...--- frontmatter fence at the start of a string.
 * Capture group 1 is the YAML body between the fences.
 */
export const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseMarkdown(raw: string): ParsedMarkdown {
  try {
    const match = raw.match(FRONTMATTER_REGEX)
    if (!match) {
      return { content: raw, frontmatter: {} }
    }

    const parsed = loadFrontmatterYaml(match[1])
    const frontmatter = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    // The body keeps its bytes after the closing fence (a blank line, the
    // final newline): an untouched document saves as it was read (#1105, #1151).
    const content = raw.slice(match[0].length)

    return { content, frontmatter }
  } catch {
    return { content: raw, frontmatter: {} }
  }
}

export function serializeMarkdown(content: string, frontmatter: Record<string, unknown>): string {
  if (Object.keys(frontmatter).length === 0) {
    return content
  }

  const yamlStr = dumpFrontmatterYaml(frontmatter).trimEnd()
  return `---\n${yamlStr}\n---\n${content}`
}

/**
 * Convert plain text newlines to paragraph breaks for TipTap.
 * In markdown, single \n is a soft break (collapsed to space).
 * For .txt files, each line should be its own paragraph.
 */
export function prepareTextContent(content: string): string {
  return content.replace(/\n/g, '\n\n').replace(/\n{3,}/g, '\n\n')
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
