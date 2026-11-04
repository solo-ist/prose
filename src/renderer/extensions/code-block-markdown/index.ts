/**
 * Code blocks that survive their own content (#1109).
 *
 * Two things went wrong on the way through markdown. A fence indented four or
 * more columns past a list item's content column is an *indented* code block
 * in CommonMark, so markdown-it hands the ```` ```sh ```` lines over as the
 * block's content; and tiptap-markdown's `codeBlock` spec wrote a
 * three-backtick fence around any content, so that block came back as a
 * fence wrapping a fence, and every save after that grew the fence count.
 *
 * Here the parser marks an indented block (`data-indented` on the `<pre>`,
 * carried as the `indented` attribute) and the serializer writes it back as
 * indented text; a fenced block gets a fence one backtick longer than the
 * longest run inside it. `IndentedCodeParse` is its own extension so the
 * `codeBlock` node keeps tiptap-markdown's parse hooks (`langPrefix`, the
 * trailing-newline `updateDOM`), which the spec merge replaces wholesale.
 */

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'

/** The slice of prosemirror-markdown's serializer state this serializer uses. */
interface SerializerState {
  write(content?: string): void
  text(text: string, escape?: boolean): void
  ensureNewLine(): void
  closeBlock(node: PMNode): void
}

interface MarkdownIt {
  utils: { escapeHtml: (text: string) => string }
  renderer: {
    rules: Record<string, unknown>
    renderAttrs: (token: unknown) => string
  }
}

type CodeBlockRule = (
  tokens: Array<{ content: string }>,
  idx: number,
  options: unknown,
  env: unknown,
  slf: MarkdownIt['renderer']
) => string

/** The fence for `content`: three backticks, or one more than the longest run inside. */
export function fenceFor(content: string): string {
  let longest = 2
  for (const run of content.matchAll(/`+/g)) longest = Math.max(longest, run[0].length)
  return '`'.repeat(longest + 1)
}

/** Each line of an indented code block, four spaces in; blank lines stay blank. */
export function indentCode(content: string): string {
  return content
    .split('\n')
    .map((line) => (line ? `    ${line}` : line))
    .join('\n')
}

/**
 * markdown-it's `code_block` token (an indented block) renders with a marker
 * the node's `indented` attribute reads. Same output as the default rule,
 * without the trailing newline tiptap-markdown strips from the default.
 */
export const IndentedCodeParse = Extension.create({
  name: 'indentedCodeParse',

  addStorage() {
    return {
      markdown: {
        parse: {
          setup(markdownit: MarkdownIt) {
            const rule: CodeBlockRule = (tokens, idx, _options, _env, slf) =>
              `<pre data-indented="true"${slf.renderAttrs(tokens[idx])}><code>${markdownit.utils.escapeHtml(
                tokens[idx]!.content
              )}</code></pre>`
            markdownit.renderer.rules.code_block = rule
          }
        }
      }
    }
  }
})

export const CodeBlockMarkdown = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      indented: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-indented') === 'true',
        renderHTML: (attributes: { indented?: boolean }) => (attributes.indented ? { 'data-indented': 'true' } : {})
      }
    }
  },

  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          const content = node.textContent
          if (node.attrs.indented) {
            // prosemirror-markdown's write() adds the enclosing block's own
            // indent to every line, so inside a list item the block keeps its
            // relative indent and parses back as the same indented block.
            state.text(indentCode(content), false)
            state.closeBlock(node)
            return
          }
          const fence = fenceFor(content)
          state.write(`${fence}${node.attrs.language || ''}\n`)
          state.text(content, false)
          state.ensureNewLine()
          state.write(fence)
          state.closeBlock(node)
        }
      }
    }
  }
})
