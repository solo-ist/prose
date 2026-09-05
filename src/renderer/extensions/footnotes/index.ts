import { InputRule } from '@tiptap/core'
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

  // markdown-it-footnote renders: <sup class="footnote-ref"><a href="#fn1">…</a></sup>
  // The class is on <sup>, not <a>. Selecting 'sup a.footnote-ref' never matches.
  // Use 'sup.footnote-ref > a' and stamp the class + tiptap-footnotes attrs onto
  // the anchor so FootnoteReference.parseHTML() can match 'a.footnote-ref:first-child'.
  element.querySelectorAll<HTMLAnchorElement>('sup.footnote-ref > a').forEach((anchor, index) => {
    const number = parseFootnoteNumber(anchor.getAttribute('href') ?? anchor.textContent, index + 1)
    anchor.classList.add('footnote-ref')
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
  addInputRules() {
    const type = this.type
    return [
      new InputRule({
        // Anchor to end ($) so TipTap's range formula is always exact.
        // The base-package rule uses unanchored /\[\^(.*?)\]/ whose
        // range.from mis-spans by one when '[' immediately follows a word
        // character, leaving a stray '[' in the text (#798).
        find: /\[\^([^\]]+)\]$/,
        handler({ state, range, match }) {
          if (!match[1]) return null
          const { tr } = state
          // replaceWith atomically deletes the full [^N] text and inserts
          // the reference node — avoiding the deleteRange + addFootnote
          // chain that mis-placed the cursor in the abutting case.
          tr.replaceWith(range.from, range.to, type.create({ 'data-id': crypto.randomUUID() }))
          tr.scrollIntoView()
        },
      }),
    ]
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
          // No `updateDOM` here: tiptap-markdown runs all extensions' updateDOM
          // hooks on the full document before any parseHTML() rules fire, so the
          // single registration on Footnotes.updateDOM is sufficient. The root
          // bug was a wrong selector ('sup a.footnote-ref') that never matched
          // markdown-it-footnote's output; fixed in normalizeMarkdownFootnotesDom.
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
