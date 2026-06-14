import Document from '@tiptap/extension-document'
import markdownItFootnote from 'markdown-it-footnote'
import { Footnote as BaseFootnote, FootnoteReference as BaseFootnoteReference, Footnotes as BaseFootnotes } from 'tiptap-footnotes'

const FOOTNOTE_ID_PREFIX = 'footnote-'

function parseFootnoteNumber(raw: string | null | undefined, fallback: number): string {
  const match = raw?.match(/(\d+)/)
  return match ? match[1] : String(fallback)
}

function normalizeMarkdownFootnotesDom(element: HTMLElement): void {
  const section = element.querySelector('section.footnotes')
  const markdownList = section?.querySelector('ol.footnotes-list, ol')
  if (markdownList) {
    markdownList.classList.remove('footnotes-list')
    markdownList.classList.add('footnotes')
    section?.replaceWith(markdownList)
  }

  element.querySelectorAll('hr.footnotes-sep').forEach((separator) => separator.remove())

  element.querySelectorAll<HTMLAnchorElement>('sup a.footnote-ref').forEach((anchor, index) => {
    const number = parseFootnoteNumber(anchor.getAttribute('href') ?? anchor.textContent, index + 1)
    anchor.textContent = number
    anchor.setAttribute('data-reference-number', number)
    anchor.setAttribute('data-id', `${FOOTNOTE_ID_PREFIX}${number}`)
    anchor.setAttribute('href', `#fn:${number}`)

    const sup = anchor.closest('sup')
    if (sup) {
      sup.setAttribute('id', `fnref:${number}`)
    }
  })

  element.querySelectorAll<HTMLLIElement>('ol.footnotes > li, ol.footnotes-list > li').forEach((item, index) => {
    const number = parseFootnoteNumber(item.getAttribute('id'), index + 1)
    item.setAttribute('id', `fn:${number}`)
    item.setAttribute('data-id', `${FOOTNOTE_ID_PREFIX}${number}`)
    item.querySelectorAll('a.footnote-backref').forEach((backref) => backref.remove())
  })
}

export const DocumentWithFootnotes = Document.extend({
  content: 'block+ footnotes?'
})

export const FootnoteReference = BaseFootnoteReference.extend({
  // tiptap-footnotes@2.x's FootnoteReference defines no addOptions, yet its
  // renderHTML reads `this.options.HTMLAttributes` — so rendering an inserted
  // reference throws "Cannot read properties of undefined (reading
  // 'HTMLAttributes')" and the footnote never appears. Provide the options the
  // node's renderHTML expects.
  addOptions() {
    return {
      ...this.parent?.(),
      HTMLAttributes: {},
    }
  },
  addStorage() {
    const parentStorage = this.parent?.() ?? {}

    return {
      ...parentStorage,
      markdown: {
        serialize(state, node) {
          const number = parseFootnoteNumber(String(node.attrs.referenceNumber ?? ''), 1)
          state.write(`[^${number}]`)
        },
        parse: {
          setup(markdownit: {
            renderer: { rules: Record<string, unknown> }
            use: (plugin: unknown) => void
          }) {
            if (!markdownit.renderer.rules.footnote_ref) {
              markdownit.use(markdownItFootnote)
            }
          }
          // No `updateDOM` here: normalizeMarkdownFootnotesDom is structural
          // (it rewrites the whole footnotes section/list) and runs once from
          // Footnotes.updateDOM on the full document. Registering it here too
          // just ran the same idempotent pass a second time.
        }
      }
    }
  }
})

export const Footnotes = BaseFootnotes.extend({
  parseHTML() {
    return [
      {
        tag: 'ol.footnotes',
        priority: 1000
      },
      {
        tag: 'ol.footnotes-list',
        priority: 1000
      }
    ]
  },
  addStorage() {
    const parentStorage = this.parent?.() ?? {}

    return {
      ...parentStorage,
      markdown: {
        serialize(state, node) {
          if (node.childCount === 0) return

          state.ensureNewLine()

          // Render each footnote body through the markdown serializer (not
          // `textContent`, which silently strips bold/italic/links/code on every
          // round-trip). `wrapBlock` mirrors prosemirror-markdown's list-item
          // serialization: `[^N]: ` prefixes the first line, a 4-space indent
          // continues wrapped/multi-paragraph bodies, and `renderContent`
          // dispatches to the registered inline + mark serializers.
          node.forEach((footnote, _offset, index) => {
            const number = index + 1
            state.wrapBlock('    ', `[^${number}]: `, footnote, () => state.renderContent(footnote))
          })

          state.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            normalizeMarkdownFootnotesDom(element)
          }
        }
      }
    }
  }
})

export const Footnote = BaseFootnote
