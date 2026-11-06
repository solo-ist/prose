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
import type { NodeView } from '@tiptap/pm/view'
import { getApi } from '../../lib/browserApi'

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

/**
 * A code block with a copy button in its corner (#1111). The `code` element is
 * the content, so lowlight's decorations and editing are untouched; the
 * button lives outside it, takes `mousedown` with `preventDefault` so the
 * caret and a drag selection in the block stay where they are, and is kept
 * out of ProseMirror's event handling and mutation observer so its label can
 * change. It copies the block's plain text, never the fence or the language.
 * A read-only editor hides it in CSS (`.ProseMirror[contenteditable=false]`).
 */
const SVG_NS = 'http://www.w3.org/2000/svg'
type Shape = [tag: string, attrs: Record<string, string>]
// Lucide's `clipboard` and `check` glyphs (ISC), built with DOM calls: no innerHTML.
const CLIPBOARD: Shape[] = [
  ['rect', { x: '8', y: '2', width: '8', height: '4', rx: '1', ry: '1' }],
  ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }]
]
const CHECK: Shape[] = [['path', { d: 'M20 6 9 17l-5-5' }]]

function svgIcon(shapes: Shape[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  const base: Record<string, string> = {
    viewBox: '0 0 24 24',
    width: '14',
    height: '14',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  }
  for (const [key, value] of Object.entries(base)) svg.setAttribute(key, value)
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(SVG_NS, tag)
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
    svg.appendChild(el)
  }
  return svg
}

function codeBlockView(node: PMNode, languageClassPrefix: string, htmlAttributes: Record<string, unknown>): NodeView {
  let current = node
  const dom = document.createElement('div')
  dom.className = 'code-block'
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  pre.appendChild(code)
  dom.appendChild(pre)
  for (const [key, value] of Object.entries(htmlAttributes)) {
    if (value !== null && value !== undefined) pre.setAttribute(key, String(value))
  }

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'code-copy'
  button.dataset.testid = 'code-copy'
  button.contentEditable = 'false'
  // A clipboard glyph, a check while "copied" (#1205); the label carries the
  // words for assistive tech and the tooltip.
  const setState = (state: 'idle' | 'copied') => {
    const label = state === 'copied' ? 'Copied' : 'Copy code'
    button.dataset.state = state
    button.setAttribute('aria-label', label)
    button.title = label
    button.replaceChildren(svgIcon(state === 'copied' ? CHECK : CLIPBOARD))
  }
  setState('idle')
  let reset: ReturnType<typeof setTimeout> | null = null
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    void getApi()
      .copyToClipboard(current.textContent)
      .then(() => {
        setState('copied')
        if (reset) clearTimeout(reset)
        reset = setTimeout(() => setState('idle'), 1500)
      })
      .catch((error) => console.error('Failed to copy code block:', error))
  })
  dom.appendChild(button)

  const sync = (n: PMNode) => {
    code.className = n.attrs.language ? `${languageClassPrefix}${n.attrs.language}` : ''
    if (n.attrs.nodeId) pre.setAttribute('data-node-id', String(n.attrs.nodeId))
    else pre.removeAttribute('data-node-id')
    if (n.attrs.indented) pre.setAttribute('data-indented', 'true')
    else pre.removeAttribute('data-indented')
  }
  sync(node)

  return {
    dom,
    contentDOM: code,
    update(next) {
      if (next.type !== node.type) return false
      current = next
      sync(next)
      return true
    },
    stopEvent(event) {
      return button.contains(event.target as Node)
    },
    ignoreMutation(mutation) {
      if (mutation.type === 'selection') return false
      return !code.contains(mutation.target)
    },
    destroy() {
      if (reset) clearTimeout(reset)
    }
  }
}

export const CodeBlockMarkdown = CodeBlockLowlight.extend({
  addNodeView() {
    const prefix = this.options.languageClassPrefix ?? 'language-'
    const htmlAttributes = (this.options.HTMLAttributes ?? {}) as Record<string, unknown>
    return ({ node }) => codeBlockView(node, prefix, htmlAttributes)
  },

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
