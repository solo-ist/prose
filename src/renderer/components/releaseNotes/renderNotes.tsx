import type { ReactNode } from 'react'
import { getApi } from '../../lib/browserApi'

/**
 * A deliberately small markdown renderer for bundled release notes.
 *
 * Why not `marked` (already a dependency) or tiptap-markdown: both produce an HTML
 * string, and the only ways to mount that are `innerHTML` / `dangerouslySetInnerHTML`
 * — which the security rules forbid for dynamic content. The notes are our own
 * bundled file rather than user content, but rendering straight to React elements
 * removes the question entirely and costs less than a sanitizer would.
 *
 * Supported, because that is all the notes template uses: `##`/`###` headings,
 * `-`/`*` bullets, paragraphs, and inline `**bold**`, `*italic*`, `` `code` `` and
 * `[text](url)`. A `#` H1 is dropped — the dialog supplies its own title. Anything
 * else renders as its own literal text, never as markup.
 */

type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }

export function parseNotes(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() })
      paragraph = []
    }
  }
  const flushList = () => {
    if (list.length) {
      blocks.push({ kind: 'list', items: list })
      list = []
    }
  }
  const flush = () => {
    flushParagraph()
    flushList()
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (!line.trim()) {
      flush()
      continue
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1].length
      // The dialog renders the version as its own title, so an H1 would duplicate it.
      if (level > 1) blocks.push({ kind: 'heading', level: level === 2 ? 2 : 3, text: heading[2] })
      continue
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      flushParagraph()
      list.push(bullet[1])
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }

  flush()
  return blocks
}

/** Inline spans. Ordered so that `**bold**` is matched before single-`*` italic. */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*]+\*|_[^_]+_)/

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`

    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)
    if (link) {
      const [, label, href] = link
      // Only http(s) reaches openExternal, which drops other protocols anyway.
      if (!/^https?:\/\//i.test(href)) return <span key={key}>{label}</span>
      return (
        <button
          key={key}
          type="button"
          className="text-primary underline underline-offset-2 hover:no-underline"
          onClick={() => void getApi().openExternal?.(href)}
        >
          {label}
        </button>
      )
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    return <span key={key}>{part}</span>
  })
}

export function RenderedNotes({ markdown }: { markdown: string }) {
  const blocks = parseNotes(markdown)

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          const Tag = block.level === 2 ? 'h3' : 'h4'
          return (
            <Tag
              key={i}
              className={
                block.level === 2
                  ? 'mt-4 text-sm font-semibold first:mt-0'
                  : 'mt-3 text-sm font-medium text-muted-foreground first:mt-0'
              }
            >
              {renderInline(block.text, `h${i}`)}
            </Tag>
          )
        }
        if (block.kind === 'list') {
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, `l${i}-${j}`)}</li>
              ))}
            </ul>
          )
        }
        return <p key={i}>{renderInline(block.text, `p${i}`)}</p>
      })}
    </div>
  )
}
