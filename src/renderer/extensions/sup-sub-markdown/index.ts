/**
 * Superscript and subscript as markdown (#1110).
 *
 * tiptap-markdown writes any mark without a markdown spec as its HTML tags,
 * so `x²` was saved as `x<sup>2</sup>`. These two extend the marks with the
 * pandoc syntax, `^x^` and `~x~`, and install the markdown-it plugins that
 * read it back, so the round trip is symmetric. Underline stays `<u>`: there
 * is no markdown syntax for it.
 */

import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import markdownItSup from 'markdown-it-sup'
import markdownItSub from 'markdown-it-sub'

interface MarkdownIt {
  use: (plugin: (md: unknown) => void) => unknown
  inline: { ruler: { __rules__: Array<{ name: string }> } }
}

const hasRule = (markdownit: MarkdownIt, name: string): boolean =>
  markdownit.inline.ruler.__rules__.some((rule) => rule.name === name)

export const SuperscriptMarkdown = Superscript.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize: { open: '^', close: '^' },
        parse: {
          setup(markdownit: MarkdownIt) {
            if (!hasRule(markdownit, 'sup')) markdownit.use(markdownItSup)
          }
        }
      }
    }
  }
})

export const SubscriptMarkdown = Subscript.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize: { open: '~', close: '~' },
        parse: {
          setup(markdownit: MarkdownIt) {
            if (!hasRule(markdownit, 'sub')) markdownit.use(markdownItSub)
          }
        }
      }
    }
  }
})
