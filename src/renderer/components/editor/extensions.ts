/**
 * The editor's extension list, in one place so the app and the test harness
 * build the same schema, parser and serializer (#1145).
 */

import StarterKit from '@tiptap/starter-kit'
import Strike from '@tiptap/extension-strike'
import { createLowlight } from 'lowlight'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import hlMarkdown from 'highlight.js/lib/languages/markdown'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import type { Extensions } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { FocusMode } from '../../lib/focusMode'
import { Comment } from '../../extensions/comments'
import type { CommentOptions } from '../../extensions/comments/types'
import { AISuggestion } from '../../extensions/ai-suggestions'
import { AIAnnotations } from '../../extensions/ai-annotations'
import { ReviewLog } from '../../extensions/review-log'
import { TrackedChanges, TrackedDelete, TrackedInsert } from '../../extensions/tracked-changes'
import type { TrackedChangesOptions } from '../../extensions/tracked-changes'
import { NodeIds } from '../../extensions/node-ids'
import { SearchHighlight } from '../../extensions/search-highlight'
import { LinkHover } from '../../extensions/link-hover'
import { PlainTextMode } from '../../extensions/plain-text-mode'
import { ImageWithUpload } from '../../extensions/image'
import { DocumentWithFootnotes, Footnote, FootnoteReference, Footnotes } from '../../extensions/footnotes'
import { PersistentSelection } from '../../extensions/persistent-selection'
import { TableCellKeymap } from '../../extensions/table-cell-keymap'
import { TableTrailingParagraph } from '../../extensions/table-trailing-paragraph'
import { TableMarkdown } from '../../extensions/table-markdown'
import { TableInputRule } from '../../extensions/table-input-rule'
import { CodeBlockMarkdown, IndentedCodeParse } from '../../extensions/code-block-markdown'
import { SubscriptMarkdown, SuperscriptMarkdown } from '../../extensions/sup-sub-markdown'
import { Identity } from '../../document/identity'

// Lowlight instance with a curated set of common languages.
// Using individual imports (not the full `common` preset) keeps the bundle
// smaller: ~12 grammars vs the 37-language common set.
const lowlight = createLowlight()
lowlight.register('javascript', javascript)
lowlight.register('js', javascript)
lowlight.register('typescript', typescript)
lowlight.register('ts', typescript)
lowlight.register('json', json)
lowlight.register('bash', bash)
lowlight.register('sh', bash)
lowlight.register('shell', bash)
lowlight.register('python', python)
lowlight.register('py', python)
lowlight.register('css', css)
lowlight.register('html', xml)
lowlight.register('xml', xml)
lowlight.register('markdown', hlMarkdown)
lowlight.register('md', hlMarkdown)
lowlight.register('rust', rust)
lowlight.register('go', go)
lowlight.register('sql', sql)
lowlight.register('yaml', yaml)
lowlight.register('yml', yaml)

/**
 * Task lists always serialize with a dash marker (`- [ ]`, the conventional
 * GFM form) regardless of the bulletListMarker preference — an asterisk next
 * to the checkbox brackets (`* [ ]`) reads as a doubled marker. Only
 * `serialize` is overridden: tiptap-markdown's getMarkdownSpec spreads its
 * default taskList spec under this one, so its markdown-it parse setup stays.
 */
const TaskListDashMarker = TaskList.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: { renderList: (node: PMNode, delim: string, marker: () => string) => void }, node: PMNode) {
          state.renderList(node, '  ', () => '- ')
        }
      }
    }
  }
})

export interface EditorExtensionOptions {
  bulletListMarker?: string
  onCommentBlocked?: CommentOptions['onCommentBlocked']
  /** An edit Suggesting mode can't track yet was refused (#891). */
  onTrackedRefused?: TrackedChangesOptions['onRefused']
}

export function createEditorExtensions(options: EditorExtensionOptions = {}): Extensions {
  return [
    // Document identity first: its plugin state is read by the plugins below.
    Identity,
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3, 4, 5, 6]
      },
      document: false,
      codeBlock: false,
      strike: false
    }),
    // Strike without its Mod-Shift-s keymap (#1169): that chord is the File
    // menu's Save As, and a key the page handles never reaches a menu
    // accelerator. Prose binds strikethrough to ⌘⇧X in Editor.tsx.
    Strike.extend({
      addKeyboardShortcuts() {
        return {}
      }
    }),
    DocumentWithFootnotes,
    // Code blocks whose markdown survives their content: indented blocks stay
    // indented, fences grow past the backtick runs inside them (#1109).
    CodeBlockMarkdown.configure({
      lowlight
    }),
    IndentedCodeParse,
    Placeholder.configure({
      placeholder: 'Start writing...'
    }),
    Link.configure({
      openOnClick: false, // We handle CMD+Click in LinkHover extension
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: {
        target: '_blank',
        rel: 'noopener noreferrer'
      }
    }),
    Underline,
    // Written as ^x^ and ~x~ rather than <sup>/<sub> (#1110).
    SuperscriptMarkdown,
    SubscriptMarkdown,
    // The table extension with a serializer that escapes `|` in cells and pads
    // ragged rows, so a pipe table survives its own content (#1107).
    TableMarkdown.configure({
      resizable: false,
      HTMLAttributes: {
        class: 'prose-table'
      }
    }),
    TableRow,
    TableHeader,
    TableCell,
    // Enter inside a cell must not split the block — see the extension for why
    // a split silently turns the table into raw HTML on save (#1060).
    TableCellKeymap,
    // A table may not be the last node in the document, or there is no way to
    // click or arrow past it (#1087).
    TableTrailingParagraph,
    // A typed header row and delimiter row become a table (#1108).
    TableInputRule,
    TaskListDashMarker,
    TaskItem.configure({
      nested: true
    }),
    Footnotes,
    Footnote,
    FootnoteReference,
    Markdown.configure({
      html: true,
      tightLists: true,
      bulletListMarker: options.bulletListMarker ?? '*',
      transformPastedText: true,
      transformCopiedText: true
    }),
    FocusMode,
    Comment.configure({
      onCommentBlocked: options.onCommentBlocked
    }),
    AISuggestion,
    // Tracked changes (#891): the two marks, Suggesting mode's state and the
    // writer's decisions. The filter itself sits in front of the view's
    // dispatch (installed by the session layer when it attaches the editor).
    TrackedInsert,
    TrackedDelete,
    TrackedChanges.configure({
      onRefused: options.onTrackedRefused
    }),
    // The review log (#1233): priority 10, after the record plugins it reads.
    ReviewLog,
    AIAnnotations.configure({
      showTooltip: true
    }),
    NodeIds,
    SearchHighlight,
    LinkHover,
    PlainTextMode,
    ImageWithUpload.configure({
      allowBase64: true,
      HTMLAttributes: {
        class: 'editor-image'
      }
    }),
    PersistentSelection
  ]
}
