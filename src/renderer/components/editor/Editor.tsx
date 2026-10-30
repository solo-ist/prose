import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useEditor as useTipTapEditor, EditorContent } from '@tiptap/react'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
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
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { FocusMode } from '../../lib/focusMode'
import { Comment } from '../../extensions/comments'
import { pushNewThreadToShare } from '../../lib/sharePush'
import { useNotificationStore } from '../../stores/notificationStore'
import { AISuggestion, AI_SUGGESTION_RESOLVED_META } from '../../extensions/ai-suggestions'
import { useSuggestionStore } from '../../extensions/ai-suggestions/store'
import { SESSION_ID } from '../../lib/persistence'
import { AIAnnotations, useAnnotationStore, reloadKeepingAnnotations } from '../../extensions/ai-annotations'
import { NodeIds } from '../../extensions/node-ids'
import { SearchHighlight } from '../../extensions/search-highlight'
import { LinkHover } from '../../extensions/link-hover'
import { PlainTextMode } from '../../extensions/plain-text-mode'
import { ImageWithUpload } from '../../extensions/image'
import { DocumentWithFootnotes, Footnote, FootnoteReference, Footnotes } from '../../extensions/footnotes'
import { PersistentSelection } from '../../extensions/persistent-selection'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
import { usePanelLayoutContext } from '../../hooks/usePanelLayout'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useFileListStore } from '../../stores/fileListStore'
import { useTabStore, scheduleSaveSession } from '../../stores/tabStore'
import { restoreEditorViewState, type EditorViewState } from '../../lib/editorViewState'
import { promoteCurrentPreview } from '../../hooks/useTabs'
import { FindBar } from './FindBar'
import { ShareStatusIcon } from '../share/ShareStatusIcon'
import { ShareStatusPopover } from '../share/ShareStatusPopover'
import { useShareStore } from '../../stores/shareStore'
import { useWebPlatformEnabled } from '../../lib/featureFlags'
import { SelectionPopover } from './SelectionPopover'
import { TableControls } from './TableControls'
import { insertTable } from '../../lib/tableCommands'
import { TableCellKeymap } from '../../extensions/table-cell-keymap'
import { TableTrailingParagraph } from '../../extensions/table-trailing-paragraph'
import { AddCommentDialog } from './AddCommentDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { EmptyState } from '../layout/EmptyState'
import { FrontmatterDisplay, hasFrontmatter, getContentWithoutFrontmatter, getFrontmatterRaw } from './FrontmatterDisplay'
import { FrontmatterEditor, serializeFrontmatter } from './FrontmatterEditor'
import { serializeMarkdown, parseMarkdown } from '../../lib/markdown'
import { TransformAnimation, useTransformAnimation } from './TransformAnimation'
import { AISuggestionPopover } from '../AISuggestionPopover'
import { CommentPopover } from '../CommentPopover'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import type { AISuggestionData } from '../../extensions/ai-suggestions/types'
import { useCommentStore } from '../../extensions/comments/store'
import { LinkPopover } from './LinkPopover'
import { SourceEditor, SourceEditorHandle } from './SourceEditor'
import { getApi } from '../../lib/browserApi'

const AI_PASTE_PROMPT_MIN_CHARS = 200

interface PendingPasteAnnotation {
  documentId: string
  from: number
  to: number
  text: string
}

/**
 * Plain-text clipboard serialization (#1054).
 *
 * tiptap-markdown registers a `clipboardTextSerializer` that serializes
 * `slice.content` directly, discarding the slice's open depths. Because
 * `Selection.content()` slices with `includeParents`, a caret-level selection
 * inside a bullet arrives as `bulletList > listItem > paragraph > "ected te"`
 * with `openStart === openEnd === 3`, and the serializer re-emits those
 * wrappers as whole blocks — putting `* ected te` on the clipboard. The same
 * mechanism adds `>` for blockquotes and `#` for headings.
 *
 * A view-level prop takes precedence over a plugin's, so registering this in
 * `editorProps` overrides tiptap-markdown without forking it.
 *
 * It must never return a falsy value: ProseMirror's `someProp` treats that as
 * "no answer" and falls through to the next registered prop — which is
 * tiptap-markdown's, reinstating the bug.
 */
function serializeSelectionAsText(slice: Slice, view: EditorView): string {
  const plain = () => slice.content.textBetween(0, slice.content.size, '\n\n')

  // A selection inside a single text block carries no block structure worth
  // preserving, so plain text is the honest answer — and it is exactly what
  // ProseMirror emits when no serializer is registered at all.
  const { $from, $to } = view.state.selection
  if ($from.sameParent($to)) return plain()

  // Otherwise markdown-serialize, first peeling redundant wrappers the same
  // way prosemirror-view does for the HTML flavor (clipboard.ts:9-16).
  // Without this a selection spanning several bullets re-emits its enclosing
  // list and gains a level of nesting.
  let content = slice.content
  let openStart = slice.openStart
  let openEnd = slice.openEnd
  while (
    openStart > 1 &&
    openEnd > 1 &&
    content.childCount === 1 &&
    content.firstChild?.childCount === 1
  ) {
    openStart--
    openEnd--
    content = content.firstChild.content
  }

  const markdownStorage = useEditorInstanceStore.getState().editor?.storage?.markdown as
    | { serializer?: { serialize: (content: unknown) => string } }
    | undefined
  const markdown = markdownStorage?.serializer?.serialize(content)
  return markdown || plain()
}

function shouldPromptForAIPaste(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return trimmed.length >= AI_PASTE_PROMPT_MIN_CHARS || trimmed.includes('\n')
}

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
        serialize(state, node) {
          state.renderList(node, '  ', () => '- ')
        }
      }
    }
  }
})

/**
 * Return focus to the editor with the caret at the nearest valid text position
 * at-or-before `pos`. A paste ending on a block boundary (multi-paragraph or
 * list content) makes the raw range-end an invalid text position — a caret set
 * there renders as a dead full-width gap that swallows typing, and Enter there
 * crashes ProseMirror ("Cannot join taskList onto paragraph", Sentry PROSE-Q).
 */
function focusEditorAtPasteEnd(pos: number): void {
  const activeEditor = useEditorInstanceStore.getState().editor
  if (!activeEditor) return
  const clamped = Math.max(0, Math.min(pos, activeEditor.state.doc.content.size))
  const target = TextSelection.near(activeEditor.state.doc.resolve(clamped), -1).from
  activeEditor.chain().focus().setTextSelection(target).run()
}

// Session-scoped flag that suppresses the AI-paste prompt for the remainder of the
// app session when the user clicks "Dismiss this Session". Not persisted — follows
// the same in-memory, session-lifetime idiom as useAnnotationStore's createdThisSession set.
let pasteAnnotationDismissedThisSession = false

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

export function Editor() {
  const { document, setContent, openFile, saveFile } = useEditor()
  const isEditing = useEditorStore((state) => state.isEditing)
  const isRemarkableReadOnly = useEditorStore((state) => state.isRemarkableReadOnly)
  const isPreviewTab = useEditorStore((state) => state.isPreviewTab)
  const annotationsVisible = useEditorStore((state) => state.annotationsVisible)
  const toggleAnnotationsVisible = useEditorStore((state) => state.toggleAnnotationsVisible)
  const sourceMode = useEditorStore((state) => state.sourceMode)
  const setSourceMode = useEditorStore((state) => state.setSourceMode)
  const { settings, effectiveTheme, setDialogOpen, setShortcutsDialogOpen, setModelPickerOpen } = useSettings()
  const { setContext, cycleToolMode } = useChat()
  const { isChatOpen, isFileListOpen, toggleChat, toggleFileList, setChatOpen, setFileListOpen } = usePanelLayoutContext()
  const setEditorInstance = useEditorInstanceStore((state) => state.setEditor)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The store write the debounce above is holding, so a tab switch can flush it (#1127). */
  const pendingWriteRef = useRef<(() => void) | null>(null)
  const isUpdatingFromStore = useRef(false)
  const frontmatterRef = useRef<string>('')
  const lastDocumentIdRef = useRef<string>(document.documentId)
  // Set by the document-switch effect when the loaded document is a tab coming
  // back with a cached view; consumed by the focus pass (#1103).
  const pendingViewRef = useRef<EditorViewState | null>(null)
  // The body the source editor last wrote to the store, so the store→editor
  // sync can tell its own echo from an external change (#1102).
  const sourceWriteRef = useRef<string | null>(null)
  // The source editor's text as of its last change, kept synchronously: on
  // exit its ref is already detached and the sourceContent state can lag (#1102).
  const latestSourceRef = useRef<string>('')
  /** The source text as shown on entering source mode — unchanged on exit means nothing to write back (#1125). */
  const sourceEntryRef = useRef<string>('')
  // What the document serialized to right after its last programmatic load
  // (file load, source-mode exit), and the store content it was loaded from.
  // Re-applying marks or decorations changes no serialized byte, so while the
  // doc still serializes to `markdown` the store keeps `content` — the bytes as
  // loaded — instead of a re-serialization nobody asked for (#1102).
  const loadBaselineRef = useRef<{ documentId: string; markdown: string; content: string } | null>(null)
  const [isFindOpen, setIsFindOpen] = useState(false)
  const [isAddCommentOpen, setIsAddCommentOpen] = useState(false)
  const webPlatformEnabled = useWebPlatformEnabled()
  const shareEntry = useShareStore((s) => s.entry)
  const sharePopoverOpen = useShareStore((s) => s.popoverOpen)
  const [pendingCommentSelection, setPendingCommentSelection] = useState<{
    from: number
    to: number
    text: string
  } | null>(null)
  const [pendingPasteAnnotation, setPendingPasteAnnotation] = useState<PendingPasteAnnotation | null>(null)
  const { isTransforming, startTransform, completeTransform } = useTransformAnimation()

  // Source mode: holds markdown content while CodeMirror is mounted
  const [sourceContent, setSourceContent] = useState<string>('')
  // Preserve AI suggestions across source mode round-trips
  const savedSuggestionsRef = useRef<AISuggestionData[]>([])
  const sourceEditorRef = useRef<SourceEditorHandle>(null)
  // The documentId whose text is currently held in the source editor. On exit,
  // the Source→WYSIWYG writeback only fires when this still matches the active
  // document — otherwise a tab switch happened and the new tab's content is
  // already loaded, so writing the (stale) source back would clobber it.
  const sourceDocIdRef = useRef<string | null>(null)

  // Track if current file is linked to a reMarkable notebook (for showing "View Original" button)
  const [linkedNotebookId, setLinkedNotebookId] = useState<string | null>(null)

  // Link popover state
  const [linkPopover, setLinkPopover] = useState<{
    isOpen: boolean
    position: { top: number; left: number }
    initialUrl?: string
  }>({ isOpen: false, position: { top: 0, left: 0 } })

  // Extract and store frontmatter on initial load
  const initialContent = useMemo(() => {
    frontmatterRef.current = getFrontmatterRaw(document.content)
    return getContentWithoutFrontmatter(document.content)
  }, []) // Only run once on mount

  // Stable frontmatter for the editor UI — re-syncs on documentId change AND on
  // shallow-value changes from the store. The shallow-value check lets external
  // writes (e.g., AI-applied frontmatter via MCP suggest_edit) surface in the UI
  // while still ignoring transient new-object references that don't change values
  // (which was the original body-edit-ripple bug this state was added to solve).
  const [stableFrontmatter, setStableFrontmatter] = useState<Record<string, unknown>>(
    () => document.frontmatter ?? {}
  )
  // A document change re-syncs during render, not in an effect: an effect lands
  // one commit late, so the returning tab's first paint built the frontmatter
  // block from the previous tab's fields and it grew a frame later. Above a
  // restored scroll offset the browser's scroll anchoring compensated for that
  // growth and the next re-apply undid it — a visible 48px hop (#1103). React
  // re-renders before committing when state is set during render.
  const [stableFrontmatterDocId, setStableFrontmatterDocId] = useState(document.documentId)
  if (stableFrontmatterDocId !== document.documentId) {
    setStableFrontmatterDocId(document.documentId)
    setStableFrontmatter(document.frontmatter ?? {})
  }

  useEffect(() => {
    if (stableFrontmatterDocId !== document.documentId) return // the render-time sync owns this case
    const next = document.frontmatter ?? {}
    // Same doc — only re-sync if the values actually differ (not just identity)
    const nextKeys = Object.keys(next)
    const currentKeys = Object.keys(stableFrontmatter)
    let differs = nextKeys.length !== currentKeys.length
    if (!differs) {
      for (const k of nextKeys) {
        if ((next as Record<string, unknown>)[k] !== (stableFrontmatter as Record<string, unknown>)[k]) {
          differs = true
          break
        }
      }
    }
    if (differs) setStableFrontmatter(next)
  }, [document.documentId, document.frontmatter, stableFrontmatter, stableFrontmatterDocId])

  const editor = useTipTapEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6]
        },
        document: false,
        codeBlock: false
      }),
      DocumentWithFootnotes,
      CodeBlockLowlight.configure({
        lowlight,
      }),
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
      Superscript,
      Subscript,
      Table.configure({
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
        bulletListMarker: settings.editor.bulletListMarker ?? '*',
        transformPastedText: true,
        transformCopiedText: true
      }),
      FocusMode,
      Comment.configure({
        // Mirror every newly-created comment mark into the persistence store so
        // replies/resolve can find it by ID immediately — without waiting for a
        // tab-switch save. Catches both the UI (AddCommentDialog) and tool
        // (add_comment) paths, since both go through setComment. Restoration
        // uses tr.addMark directly and does NOT fire this, so no double-add.
        onCommentAdded: (commentData) => {
          const store = useCommentStore.getState()
          if (store.pendingComments.some((c) => c.id === commentData.id)) return
          const updated = [
            ...store.pendingComments,
            { ...commentData, replies: [], resolved: false },
          ]
          useCommentStore.setState({ pendingComments: updated })
          if (store.documentId) store.saveComments(store.documentId, updated)
          // Live new-thread push (#769): the conversation is always live — a
          // comment created here becomes a server row on the publication
          // immediately. No-op when the document isn't published.
          pushNewThreadToShare(commentData.id)
        },
        // setComment refuses ranges that would swallow an existing thread's
        // mark (#830) — tell the user to reply on that thread instead.
        onCommentBlocked: () => {
          useNotificationStore.getState().notify({
            id: 'comment-overlap-blocked',
            message: 'This text already has a comment — reply to the existing thread instead of adding a new one.',
          })
        },
      }),
      AISuggestion,
      AIAnnotations.configure({
        showTooltip: true,
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
      PersistentSelection,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'outline-hidden min-h-full'
      },
      clipboardTextSerializer: serializeSelectionAsText,
      handlePaste: (view, event) => {
        const pastedText = event.clipboardData?.getData('text/plain') ?? ''
        if (!shouldPromptForAIPaste(pastedText)) return false

        const editorState = useEditorStore.getState()
        if (
          editorState.sourceMode ||
          editorState.isRemarkableReadOnly ||
          editorState.isPreviewTab ||
          !editorState.document.documentId
        ) {
          return false
        }

        const documentId = editorState.document.documentId
        const selectionFrom = view.state.selection.from
        const selectionTo = view.state.selection.to
        const replacedSize = selectionTo - selectionFrom
        const sizeBefore = view.state.doc.content.size

        setTimeout(() => {
          const activeEditor = useEditorInstanceStore.getState().editor
          const activeDocumentId = useEditorStore.getState().document.documentId
          if (!activeEditor || activeDocumentId !== documentId) return

          const sizeAfter = activeEditor.state.doc.content.size
          const insertedSize = Math.max(0, sizeAfter - sizeBefore + replacedSize)
          const selectionEnd = activeEditor.state.selection.from
          const fallbackTo = selectionFrom + insertedSize
          const annotationTo = Math.min(
            activeEditor.state.doc.content.size,
            Math.max(selectionEnd, fallbackTo)
          )

          if (annotationTo > selectionFrom && !pasteAnnotationDismissedThisSession) {
            setPendingPasteAnnotation({
              documentId,
              from: selectionFrom,
              to: annotationTo,
              text: pastedText,
            })
          }
        }, 0)

        return false
      },
      handleDOMEvents: {
        mousedown: () => {
          // Clicking the editor while in preview mode promotes the tab
          if (useEditorStore.getState().isPreviewTab) {
            promoteCurrentPreview()
          }
          return false
        }
      }
    },
    // Note: No onCreate needed - editor is created with initial content,
    // so history naturally starts from that state
    onUpdate: ({ editor }) => {
      if (isUpdatingFromStore.current) return
      // Source mode owns the document while it is open; the hidden TipTap doc
      // is stale until the exit writeback, so it must never write the store (#1102).
      if (useEditorStore.getState().sourceMode) return

      console.log('[Editor:onUpdate] Content changed, scheduling save')

      // Capture the current document ID so we can discard the update if the
      // user switches tabs before the debounce fires (prevents cross-tab dirty state)
      const capturedDocumentId = useEditorStore.getState().document.documentId

      // Debounce content updates to store
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      const write = () => {
        // If the active document changed since this was scheduled (tab switch),
        // discard the update to avoid marking the wrong tab as dirty
        if (useEditorStore.getState().document.documentId !== capturedDocumentId) {
          console.log('[Editor:onUpdate] Document changed, discarding stale content update')
          return
        }

        const markdown = editor.storage.markdown.getMarkdown()
        // Prepend frontmatter if present — unless nothing serializable changed
        // since the last load, in which case keep the bytes as loaded (#1102).
        const baseline = loadBaselineRef.current
        const fullContent =
          baseline && baseline.documentId === capturedDocumentId && baseline.markdown === markdown
            ? baseline.content
            : frontmatterRef.current + markdown
        console.log('[Editor:onUpdate] Saving content to store:', {
          length: fullContent.length,
          preview: fullContent.substring(0, 100).replace(/\n/g, '\\n'),
          hasTable: fullContent.includes('|')
        })
        setContent(fullContent)
      }
      // Kept so a tab switch can flush it before the switch: an edit inside
      // this window otherwise reached neither the store nor the tab (#1127).
      pendingWriteRef.current = write
      debounceRef.current = setTimeout(() => {
        pendingWriteRef.current = null
        debounceRef.current = null
        write()
      }, 500)
    }
  })

  // Helper to open comment dialog with current selection (add-new mode)
  const openAddCommentDialog = useCallback(() => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return // No selection
    const text = editor.state.doc.textBetween(from, to, ' ')
    setPendingCommentSelection({ from, to, text })
    setIsAddCommentOpen(true)
  }, [editor])

  // Helper to open inline link popover
  const openLinkPopover = useCallback(() => {
    if (!editor) return
    const { to } = editor.state.selection
    const coords = editor.view.coordsAtPos(to)
    const previousUrl = editor.getAttributes('link').href || ''
    setLinkPopover({
      isOpen: true,
      position: { top: coords.bottom + 4, left: coords.left },
      initialUrl: previousUrl,
    })
  }, [editor])

  // Sync content from store to editor when document changes externally
  useEffect(() => {
    if (!editor) return

    // Extract frontmatter and body from the new content
    const newFrontmatter = getFrontmatterRaw(document.content)
    const newBody = getContentWithoutFrontmatter(document.content)

    // Get current editor content (without frontmatter since we strip it)
    const currentMarkdown = editor.storage.markdown?.getMarkdown() || ''

    // Check if this is a new document (different documentId)
    const isNewDocument = lastDocumentIdRef.current !== document.documentId
    if (isNewDocument) {
      lastDocumentIdRef.current = document.documentId
      // The view the active tab cached when it was last left, if this load is
      // that tab coming back (#1103). Every switch path activates the tab
      // before it writes the document, so the ids line up here. The focus
      // pass below consumes it.
      const activeTab = useTabStore.getState().getActiveTab()
      pendingViewRef.current =
        activeTab?.documentId === document.documentId ? activeTab.viewState ?? null : null
    }

    // Source mode is authoritative (#1102). A store write while it is open is
    // the source editor's own typing coming back: parsing it into the hidden
    // TipTap doc strips the marks and, through onUpdate, re-serialized the
    // whole document; echoing it into CodeMirror reset the caret and dropped
    // the frontmatter block. Only a genuine external change reaches the source
    // view, and TipTap is written once, on exit. A new document still loads —
    // the document-switch reset turns source mode off after this effect runs.
    if (!isNewDocument && useEditorStore.getState().sourceMode) {
      if (document.content !== sourceWriteRef.current) {
        latestSourceRef.current = serializeMarkdown(newBody, useEditorStore.getState().document.frontmatter ?? {})
        setSourceContent(latestSourceRef.current)
      }
      return
    }

    // Check if body content differs (comparing without frontmatter). The store
    // holding the bytes as loaded while TipTap still serializes to the load's
    // baseline is in sync too: the difference is only serializer normalization,
    // and re-parsing over it — on the source exit's own write — would strip the
    // marks (until the exit's restore re-applies them), add an undo step, and
    // scroll to the top.
    const baseline = loadBaselineRef.current
    const matchesBaseline =
      !isNewDocument &&
      !!baseline &&
      baseline.documentId === document.documentId &&
      baseline.content === document.content &&
      baseline.markdown === currentMarkdown
    if (newBody !== currentMarkdown && !matchesBaseline) {
      isUpdatingFromStore.current = true
      frontmatterRef.current = newFrontmatter

      // Sync plain text mode BEFORE setContent so appendTransaction
      // doesn't flatten markdown content on tab switches
      const isPlainText = !!document.path?.endsWith('.txt')
      editor.storage.plainTextMode.enabled = isPlainText

      // If source mode is active, sync content directly to the source editor
      // (the TipTap editor is hidden, so we update sourceContent too)
      if (useEditorStore.getState().sourceMode) {
        setSourceContent(newBody)
      }

      if (isNewDocument) {
        // Create a fresh EditorState when loading a new document.
        // This resets the undo history so users can't undo past the initial document state.
        // Note: TipTap's clearHistory() doesn't exist - ProseMirror requires recreating the state.

        // First, set the content to let tiptap-markdown parse it
        editor.commands.setContent(newBody)

        // Now create a fresh state with the parsed document (this clears history)
        const newState = EditorState.create({
          doc: editor.state.doc,
          plugins: editor.state.plugins,
          schema: editor.state.schema,
        })
        editor.view.updateState(newState)
        // A tab being returned to comes back where it was left (#1103).
        if (pendingViewRef.current) restoreEditorViewState(editor, pendingViewRef.current)
      } else {
        // Normal content update - preserve history so user can undo their edits
        editor.commands.setContent(newBody)
      }

      isUpdatingFromStore.current = false
      loadBaselineRef.current = {
        documentId: document.documentId,
        markdown: editor.storage.markdown?.getMarkdown() || '',
        content: document.content,
      }

      // The setContent/updateState above dispatched the document-load transaction
      // which correctly skipped position updates (isLoadingDocument was true). Now
      // that the load transaction has fired, clear the guard immediately so the
      // NEXT user-initiated transaction (e.g. accept_diff) runs updatePositions.
      // The 100ms setTimeout in select_tab / executeOpenFile remains as a fallback
      // for tab switches where content didn't change.
      useAnnotationStore.getState().setLoadingDocument(false)

      // Scroll to top when new content is loaded, unless a tab's own view was
      // just put back above.
      const editorContainer = editor.view.dom.closest('.overflow-auto')
      if (editorContainer && !pendingViewRef.current) {
        editorContainer.scrollTop = 0
      }
    } else if (isNewDocument && pendingViewRef.current) {
      // Same body as the tab we left (nothing was reloaded): restore in place.
      restoreEditorViewState(editor, pendingViewRef.current)
    } else if (newFrontmatter !== frontmatterRef.current) {
      // Just update frontmatter ref if only frontmatter changed
      frontmatterRef.current = newFrontmatter
    }
  }, [editor, document.content, document.documentId])

  // Register editor instance in store for cross-component access.
  // On cleanup (HMR remount or unmount), snapshot any live AI suggestions into
  // the suggestion store so the next mount can replay them via the existing
  // restoreAISuggestions useEffect — without touching the autosave pipeline.
  useEffect(() => {
    setEditorInstance(editor)
    // Moving the caret or scrolling re-arms the session save (1s debounce), so
    // the active tab's live view reaches the saved session for a relaunch; the
    // save only ran on tab-store changes before, which neither of these is (#1103).
    // Scroll is listened for on the window (capture): the scroll container is
    // re-created around a source-mode toggle, so a listener on it would be lost.
    const rearmSessionSave = () => scheduleSaveSession()
    editor?.on('selectionUpdate', rearmSessionSave)
    window.addEventListener('scroll', rearmSessionSave, { capture: true, passive: true })
    useEditorInstanceStore.setState({
      flushPendingUpdate: () => {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current)
          debounceRef.current = null
        }
        const write = pendingWriteRef.current
        pendingWriteRef.current = null
        write?.()
      },
    })
    return () => {
      editor?.off('selectionUpdate', rearmSessionSave)
      window.removeEventListener('scroll', rearmSessionSave, { capture: true })
      useEditorInstanceStore.setState({ flushPendingUpdate: null })
      setEditorInstance(null)
      // Snapshot live suggestions for HMR replay (option 2 from issue #531).
      // Only runs when there is an editor with an active document — skips
      // clean unmounts where document.documentId is empty (e.g., empty state).
      if (editor && document.documentId) {
        const liveSuggestions = getAISuggestions(editor)
        if (liveSuggestions.length > 0) {
          useSuggestionStore.getState().snapshotSuggestions(document.documentId, liveSuggestions)
        }
      }
    }
  }, [editor, setEditorInstance, document.documentId])

  // Cache selection on selectionUpdate for read_selection fallback
  // This preserves the selection when chat input steals focus.
  // Also computes and pushes the live cursor position to editorStore (#564).
  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      const { from, to, empty } = editor.state.selection
      if (!empty) {
        const text = editor.state.doc.textBetween(from, to)
        useEditorStore.getState().setLastSelection({ text, from, to })
      }

      // Update cursor position for status bar (#564)
      const headPos = editor.state.selection.$head.pos
      const textBefore = editor.state.doc.textBetween(0, headPos, '\n')
      const lines = textBefore.split('\n')
      useEditorStore.getState().setCursorPosition(lines.length, (lines[lines.length - 1]?.length ?? 0) + 1)
    }

    editor.on('selectionUpdate', handleSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor])

  // Update editor editability when read-only mode changes (reMarkable or preview tab)
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!isRemarkableReadOnly && !isPreviewTab)
  }, [editor, isRemarkableReadOnly, isPreviewTab])

  // Sync bulletListMarker setting without requiring an editor remount.
  // tiptap-markdown shallow-copies its options into editor.storage.markdown
  // during onBeforeCreate, and the bullet-list serializer reads that copy at
  // serialize time — mutating the extension's own options has no effect, so
  // the storage copy is the object that must be updated.
  useEffect(() => {
    if (!editor) return
    const markdownStorage = editor.storage.markdown as { options?: { bulletListMarker?: string } } | undefined
    if (markdownStorage?.options) {
      markdownStorage.options.bulletListMarker = settings.editor.bulletListMarker ?? '*'
    }
  }, [editor, settings.editor.bulletListMarker])

  // Check if current file is linked to a reMarkable notebook
  useEffect(() => {
    const checkLinkedNotebook = async () => {
      const syncDir = useSettingsStore.getState().settings.remarkable?.syncDirectory
      if (!document.path || !syncDir || !window.api?.remarkableFindNotebookByFilePath) {
        setLinkedNotebookId(null)
        return
      }

      // Only check files in the sync directory (not hidden OCR files)
      if (!document.path.includes(syncDir.replace('~', ''))) {
        setLinkedNotebookId(null)
        return
      }

      const notebookId = await window.api.remarkableFindNotebookByFilePath(document.path, syncDir)
      setLinkedNotebookId(notebookId)
    }

    checkLinkedNotebook()
  }, [document.path])

  // Trigger annotation load when the document changes. The ai-annotations plugin
  // subscribes to the store and rebuilds its decorations on any store change
  // (including after this async load and on add/remove), so no manual decoration
  // dispatch is needed here.
  const annotationStoreDocumentId = useAnnotationStore((state) => state.documentId)

  useEffect(() => {
    if (!editor || !document.documentId) return
    if (annotationStoreDocumentId !== document.documentId) {
      const annotationStore = useAnnotationStore.getState()
      annotationStore.setDocumentId(document.documentId)
      annotationStore.loadAnnotations(document.documentId)
    }
  }, [editor, document.documentId, annotationStoreDocumentId])

  // Subscribe to pending suggestions reactively for restoration
  const pendingSuggestions = useSuggestionStore((state) => state.pendingSuggestions)
  const suggestionStoreDocumentId = useSuggestionStore((state) => state.documentId)

  // Load suggestions when the document changes (mirrors the annotation + comment
  // recovery effects). Session restore / file open hydrate the editor without
  // going through useTabs' explicit loadSuggestions, so without this a document's
  // AI suggestions are lost on reload. loadSuggestions populates pendingSuggestions;
  // the restore effect below re-applies them to the editor.
  useEffect(() => {
    if (!editor || !document.documentId) return
    if (suggestionStoreDocumentId !== document.documentId) {
      useSuggestionStore.getState().loadSuggestions(document.documentId)
    }
  }, [editor, document.documentId, suggestionStoreDocumentId])

  // Restore AI suggestions when document changes or pending suggestions are loaded
  useEffect(() => {
    if (!editor || !document.documentId) return

    // Only restore if there are pending suggestions and they match current document
    if (pendingSuggestions.length > 0 && suggestionStoreDocumentId === document.documentId) {
      // Wait for the document content to be present (see the comment-restore
      // effect): on reload the file loads asynchronously, and restoring against
      // an empty doc would drop the suggestions, then clearSuggestions() consumes
      // them. document.content is in the deps so this re-fires once text arrives.
      if (!editor.state.doc.textContent.trim()) return

      console.log(`[Editor:${SESSION_ID}] Restoring suggestions:`, {
        documentId: document.documentId,
        count: pendingSuggestions.length
      })

      // Small delay to ensure editor content is fully loaded
      const timer = setTimeout(() => {
        editor.commands.restoreAISuggestions(pendingSuggestions)
        // Clear pending suggestions after restoring
        useSuggestionStore.getState().clearSuggestions()
      }, 100)

      return () => clearTimeout(timer)
    }
  }, [editor, document.documentId, pendingSuggestions, suggestionStoreDocumentId, document.content])

  // Persist suggestions to IndexedDB when they change, so they survive a reload.
  // snapshotSuggestions only buffers in-memory (HMR), and tab-switch saves are
  // too infrequent — creating a suggestion then refreshing would lose it. Saving
  // on a debounced transaction also keeps stored positions in sync as the doc
  // edits. Skip while a restore is pending (pendingSuggestions not yet replayed)
  // so the document-load transaction can't clobber IndexedDB with an empty set.
  useEffect(() => {
    if (!editor || !document.documentId) return
    const docId = document.documentId
    let timer: ReturnType<typeof setTimeout> | null = null
    // Set when the writer accepted or rejected a suggestion since the last
    // persist — the one case where an empty live set is intent (#1126).
    let resolved = false
    const persist = () => {
      timer = null
      const store = useSuggestionStore.getState()
      if (store.pendingSuggestions.length > 0) return // restore pending — don't clobber
      const live = getAISuggestions(editor)
      const userResolved = resolved
      resolved = false
      // NEVER overwrite the stored set with an empty one from a routine
      // transaction. An empty editor here is almost always transient — a
      // document load or a source-mode toggle strips the decorations and fires a
      // transaction — NOT a real "user cleared all". Persisting that empty wiped
      // suggestions from IndexedDB (data loss). Mirrors useTabs' deliberate
      // `length > 0 ? save : skip`; genuine empties persist via tab-close/delete —
      // and via an accept/reject that emptied the set: without that, the stale
      // set came back on the next tab switch (#1126).
      if (live.length === 0) {
        if (userResolved) store.deleteSuggestions(docId)
        return
      }
      store.saveSuggestions(docId, live)
    }
    const onTx = ({ transaction }: { transaction: { getMeta: (key: string) => unknown } }) => {
      if (timer) clearTimeout(timer)
      if (transaction.getMeta(AI_SUGGESTION_RESOLVED_META)) {
        // Persist now, not after the debounce: a tab switch inside those 500ms
        // clears the timer, and the stale set would be what the switch back loads.
        resolved = true
        persist()
        return
      }
      timer = setTimeout(persist, 500)
    }
    editor.on('transaction', onTx)
    return () => {
      editor.off('transaction', onTx)
      if (timer) clearTimeout(timer)
    }
  }, [editor, document.documentId])

  // Subscribe to comment store state. pendingComments stays populated (it's the
  // live source of truth for replies/resolved); needsRestore is the one-shot
  // signal that the marks must be re-applied to the editor after a load.
  const needsRestore = useCommentStore((state) => state.needsRestore)
  const commentStoreDocumentId = useCommentStore((state) => state.documentId)

  // Load comments when the document changes (mirrors the annotation recovery
  // effect above). Session restore and file-open hydrate the editor without
  // going through useTabs' explicit loadComments calls, so without this the
  // comment store stays empty and a document's threads are lost on reload.
  // loadComments sets needsRestore; the restore effect below re-applies marks.
  useEffect(() => {
    if (!editor || !document.documentId) return
    if (commentStoreDocumentId !== document.documentId) {
      useCommentStore.getState().loadComments(document.documentId)
    }
  }, [editor, document.documentId, commentStoreDocumentId])

  // Re-apply comment marks once after each load. Marks aren't serialized into
  // the document, so they must be restored when content (re)loads — but NOT on
  // every pendingComments change (a reply/resolve must not re-mark the doc).
  // needsRestore gates this; we consume it whether or not there are comments.
  useEffect(() => {
    if (!editor || !document.documentId) return
    if (!needsRestore || commentStoreDocumentId !== document.documentId) return

    // Wait for the document content to actually be present before restoring. On
    // reload, file content loads asynchronously from disk; restoring against an
    // empty doc finds no text to mark and would then consume the one-shot flag,
    // losing the marks until the next load. document.content is in the deps, so
    // this re-fires once the real text arrives. (If there are no pending comments
    // there's nothing to lose, so don't block on content.)
    const hasPending = useCommentStore.getState().pendingComments.length > 0
    const contentReady = !!editor.state.doc.textContent.trim()
    if (hasPending && !contentReady) return

    // Small delay to ensure editor content is fully loaded (same pattern as suggestions)
    const timer = setTimeout(() => {
      const fresh = useCommentStore.getState().pendingComments
      if (fresh.length > 0) {
        console.log(`[Editor:${SESSION_ID}] Restoring comments:`, {
          documentId: document.documentId,
          count: fresh.length
        })
        editor.commands.restoreComments(fresh)
      }
      // Consume the one-shot flag — but keep pendingComments populated so the
      // CommentPopover thread + Activity timeline keep reading replies/resolved.
      useCommentStore.getState().markRestored()
    }, 100)

    return () => clearTimeout(timer)
  }, [editor, document.documentId, needsRestore, commentStoreDocumentId, document.content])

  // Auto-focus editor once when document loads (not on every content change)
  const hasFocusedRef = useRef(false)
  useEffect(() => {
    // Reset focus tracking when document changes
    hasFocusedRef.current = false
  }, [document.documentId])

  useEffect(() => {
    // Only focus once per document load
    if (hasFocusedRef.current) return
    // Don't steal focus during preview tab navigation. Mark focus as handled so a
    // later promotion to a permanent tab (e.g. the user clicks mid-document) doesn't
    // re-run this effect and yank the caret/scroll back to the top (#729).
    if (useEditorStore.getState().isPreviewTab) {
      hasFocusedRef.current = true
      // The document-switch effect already put a returning preview tab's view
      // back; nothing to re-apply without focus (#1103).
      pendingViewRef.current = null
      return
    }

    const shouldShowEmptyState = !isEditing && !document.path && !document.content && !document.isDirty
    if (editor && !shouldShowEmptyState) {
      hasFocusedRef.current = true
      const restoredView = pendingViewRef.current
      pendingViewRef.current = null
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        if (restoredView) {
          // Back on a tab that was left mid-document (#1103): keep the
          // restored selection and re-apply the offset after layout settled.
          editor.commands.focus(undefined, { scrollIntoView: false })
          restoreEditorViewState(editor, restoredView)
          return
        }
        editor.commands.focus('start')
        // Scroll editor container to top
        const editorContainer = editor.view.dom.closest('.overflow-auto')
        if (editorContainer) {
          editorContainer.scrollTop = 0
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [editor, isEditing, document.path, document.content, document.isDirty])

  // Sync content when toggling source mode (layout effect to avoid flash of empty content)
  const prevSourceModeRef = useRef(sourceMode)
  useLayoutEffect(() => {
    if (!editor) return
    const prev = prevSourceModeRef.current
    prevSourceModeRef.current = sourceMode

    if (sourceMode && !prev) {
      // WYSIWYG → Source: save suggestions then serialize with frontmatter
      savedSuggestionsRef.current = getAISuggestions(editor)
      sourceDocIdRef.current = useEditorStore.getState().document.documentId
      // Open on the bytes as loaded when nothing serializable changed since the
      // load — otherwise source mode would show TipTap's re-serialization and the
      // first keystroke would commit it (#1102). After a WYSIWYG edit the
      // serialization is the only source of those edits.
      const live = editor.storage.markdown?.getMarkdown?.() ?? ''
      const baseline = loadBaselineRef.current
      const md =
        baseline && baseline.documentId === sourceDocIdRef.current && baseline.markdown === live
          ? getContentWithoutFrontmatter(baseline.content)
          : live
      const fm = useEditorStore.getState().document.frontmatter ?? {}
      latestSourceRef.current = serializeMarkdown(md, fm)
      sourceEntryRef.current = latestSourceRef.current
      setSourceContent(latestSourceRef.current)
    } else if (!sourceMode && prev) {
      // A document switch (not a user toggle) also flips sourceMode → false. In
      // that case the new tab's content is already loaded by the content-sync
      // effect, while the source editor still holds the PREVIOUS document's text.
      // Writing that stale source back here would clobber the new tab — so when
      // the active document no longer matches the source's document, skip the
      // writeback and drop the previous doc's saved suggestions.
      // (#bug: source persists across tabs)
      const activeDocId = useEditorStore.getState().document.documentId
      if (sourceDocIdRef.current !== activeDocId) {
        savedSuggestionsRef.current = []
        return
      }
      const liveContent = sourceEditorRef.current?.getContent() ?? latestSourceRef.current
      // Nothing typed: the TipTap doc, the store and every mark are exactly as
      // they were on entry, so there is nothing to write back. The unconditional
      // writeback below re-parses the source and calls setFrontmatter, which
      // marks the document dirty — so an untouched toggle dirtied every
      // document, and parseMarkdown's trim dropped the body's trailing newline
      // (#1125).
      if (liveContent === sourceEntryRef.current) {
        savedSuggestionsRef.current = []
        return
      }
      // Source → WYSIWYG: parse frontmatter back out from raw source
      const { content: bodyOnly, frontmatter: parsedFm } = parseMarkdown(liveContent)
      useEditorStore.getState().setFrontmatter(parsedFm)
      // Mapping AI annotations through a whole-document replace would detach
      // every one of them; re-anchor them by their text instead.
      reloadKeepingAnnotations(editor, () => editor.commands.setContent(bodyOnly))
      // The single writeback (#1102), written to the store explicitly: setContent
      // emits no update, and the source editor's debounce is cleared — not
      // flushed — on unmount, so keystrokes from its last 500ms reached TipTap
      // but never the store, and a save dropped them. The baseline is set
      // first, so the store→editor sync reads this write as in sync rather
      // than re-parsing over the mark restore below; later mark-only updates
      // keep these bytes rather than re-serializing them.
      loadBaselineRef.current = {
        documentId: activeDocId,
        markdown: editor.storage.markdown?.getMarkdown() ?? '',
        content: frontmatterRef.current + bodyOnly,
      }
      useEditorStore.getState().setContent(loadBaselineRef.current.content)
      // setContent stripped both suggestion decorations AND comment marks. The
      // document didn't change, so neither the suggestion- nor comment-restore
      // effects will re-run — we must re-apply both here, or a source round-trip
      // silently drops them from the body (while the stores keep the data).
      const comments = useCommentStore.getState().pendingComments
      setTimeout(() => {
        if (savedSuggestionsRef.current.length > 0) {
          editor.commands.restoreAISuggestions(savedSuggestionsRef.current)
          savedSuggestionsRef.current = []
        }
        if (comments.length > 0) {
          editor.commands.restoreComments(comments)
        }
      }, 50)
    }
  }, [sourceMode, editor])

  // Reset source mode when switching documents. The toggle effect's
  // Source→WYSIWYG branch guards against clobbering the new tab by comparing
  // sourceDocIdRef to the active document (see above).
  useEffect(() => {
    setSourceMode(false)
  }, [document.documentId, setSourceMode])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMod = e.metaKey || e.ctrlKey

    if (isMod && e.key === 'n' && !e.shiftKey) {
      // Cmd+N: New document — prevent browser's "new window" in web mode
      e.preventDefault()
      // Dispatch to useTabs via a custom event (Toolbar/App owns createNewTab)
      window.dispatchEvent(new CustomEvent('menu:new'))
    } else if (isMod && e.key === 'o' && !e.shiftKey) {
      e.preventDefault()
      openFile()
    } else if (isMod && e.key === 's' && !e.shiftKey) {
      e.preventDefault()
      saveFile().catch((error) => {
        console.error('[Editor] Failed to save from shortcut:', error)
      })
    } else if (isMod && e.key === ',') {
      e.preventDefault()
      setDialogOpen(true)
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'k') {
      // Cmd+Shift+K: Add selection as context
      e.preventDefault()
      if (editor) {
        const { from, to } = editor.state.selection
        if (from !== to) {
          const selectedText = editor.state.doc.textBetween(from, to, '\n')
          if (selectedText.trim()) {
            setContext(selectedText)
            setChatOpen(true)
          }
        }
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'c') {
      // Cmd+Shift+C: Copy Markdown
      e.preventDefault()
      const content = useEditorStore.getState().document.content
      if (content) {
        getApi().copyToClipboard(content)
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'h') {
      // Cmd+Shift+H: Toggle file list (JS fallback for macOS menu accelerator)
      e.preventDefault()
      toggleFileList()
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'l') {
      // Cmd+Shift+L: Toggle chat panel
      e.preventDefault()
      toggleChat()
    } else if (e.key === 'Escape') {
      // Escape cascade: find bar → chat → file list → exit fullscreen
      if (isFindOpen) {
        setIsFindOpen(false)
      } else if (isChatOpen) {
        setChatOpen(false)
      } else if (isFileListOpen) {
        setFileListOpen(false)
      } else if (window.api?.exitFullScreen) {
        window.api.exitFullScreen()
      }
    } else if (isMod && e.key === 'f' && !e.shiftKey) {
      // Cmd+F: Open find bar (skip in source mode — CodeMirror handles its own)
      if (useEditorStore.getState().sourceMode) return
      e.preventDefault()
      if (isFindOpen) {
        // Bar already open — refocus and select the input so the user can type a new term
        window.dispatchEvent(new CustomEvent('find:focus'))
      } else {
        setIsFindOpen(true)
      }
    } else if (isMod && e.key === 'l' && !e.shiftKey) {
      // Cmd+L: Select current line
      e.preventDefault()
      if (editor) {
        const { $from } = editor.state.selection
        const start = $from.start()
        const end = $from.end()
        editor.commands.setTextSelection({ from: start, to: end })
      }
    } else if (isMod && e.key === 'd' && !e.shiftKey) {
      // Cmd+D: Duplicate current line
      e.preventDefault()
      if (editor) {
        const { $from } = editor.state.selection
        const start = $from.start()
        const end = $from.end()
        const lineText = editor.state.doc.textBetween(start, end, '\n')
        editor.chain()
          .setTextSelection(end)
          .insertContent('\n' + lineText)
          .run()
      }
    } else if (isMod && e.shiftKey && e.key === 'Backspace') {
      // Cmd+Shift+Backspace: Delete current line
      e.preventDefault()
      if (editor) {
        const { $from } = editor.state.selection
        const start = $from.start()
        const end = $from.end()
        // Delete from start of line to end, including the newline before if not first line
        const deleteFrom = start > 1 ? start - 1 : start
        editor.chain()
          .setTextSelection({ from: deleteFrom, to: end })
          .deleteSelection()
          .run()
      }
    } else if (isMod && e.key === '/' && !e.shiftKey) {
      // Cmd+/: Toggle HTML comment
      e.preventDefault()
      if (editor) {
        const { from, to } = editor.state.selection
        const selectedText = editor.state.doc.textBetween(from, to, '\n')

        if (selectedText.startsWith('<!--') && selectedText.endsWith('-->')) {
          // Uncomment: remove comment markers
          const uncommented = selectedText.slice(4, -3).trim()
          editor.chain()
            .setTextSelection({ from, to })
            .insertContent(uncommented)
            .run()
        } else {
          // Comment: wrap in comment markers
          const commented = `<!-- ${selectedText} -->`
          editor.chain()
            .setTextSelection({ from, to })
            .insertContent(commented)
            .run()
        }
      }
    } else if (e.key === 'F1') {
      // F1: Show keyboard shortcuts
      e.preventDefault()
      setShortcutsDialogOpen(true)
    } else if (e.shiftKey && e.key === 'Tab' && !isMod) {
      // Shift+Tab: Cycle through tool modes (chat → editor → create → chat).
      // Editor must be reachable via keyboard — it's the new safe-by-default
      // mode, and the previous binary agentMode toggle skipped it.
      e.preventDefault()
      cycleToolMode()
    } else if (isMod && e.key === 'k' && !e.shiftKey) {
      // Cmd+K: Insert/edit link
      e.preventDefault()
      if (editor) {
        openLinkPopover()
      }
    } else if (isMod && e.key === 'u' && !e.shiftKey) {
      // Cmd+U: Underline
      e.preventDefault()
      if (editor) {
        editor.chain().focus().toggleUnderline().run()
      }
    } else if (isMod && e.shiftKey && e.code === 'Period') {
      // Cmd+Shift+.: Superscript
      e.preventDefault()
      if (editor) {
        editor.chain().focus().unsetSubscript().toggleSuperscript().run()
      }
    } else if (isMod && e.shiftKey && e.code === 'Comma') {
      // Cmd+Shift+,: Subscript
      e.preventDefault()
      if (editor) {
        editor.chain().focus().unsetSuperscript().toggleSubscript().run()
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'x') {
      // Cmd+Shift+X: Strikethrough
      e.preventDefault()
      if (editor) {
        editor.chain().focus().toggleStrike().run()
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'f') {
      // Cmd+Shift+F: Insert footnote citation. Collapse any active selection to
      // its end first — addFootnote inserts at the selection anchor without
      // clearing it, so otherwise a subsequent Enter deletes the selected text.
      // Collapsing (vs deleting) keeps the text and drops the marker after it.
      e.preventDefault()
      if (editor) {
        const { to } = editor.state.selection
        editor.chain().focus().setTextSelection(to).addFootnote().run()
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'e') {
      // Cmd+Shift+E: Toggle source view (disabled in read-only mode)
      e.preventDefault()
      const { isRemarkableReadOnly: rmReadOnly, isPreviewTab: previewTab } = useEditorStore.getState()
      if (!rmReadOnly && !previewTab) {
        useEditorStore.getState().toggleSourceMode()
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'a') {
      // Cmd+Shift+A: Add comment to selection
      e.preventDefault()
      openAddCommentDialog()
    } else if (e.altKey && !isMod && e.key === 'ArrowUp') {
      // Alt+Up: Move line up
      e.preventDefault()
      if (editor) {
        const { $from } = editor.state.selection
        const currentLine = $from.before($from.depth)
        if (currentLine > 1) {
          // Get the previous line's position
          const prevLineStart = editor.state.doc.resolve(currentLine - 1).before($from.depth)
          const currentLineEnd = $from.after($from.depth)
          const currentLineContent = editor.state.doc.textBetween($from.start(), $from.end(), '\n')
          const prevLineContent = editor.state.doc.textBetween(
            editor.state.doc.resolve(currentLine - 1).start(),
            editor.state.doc.resolve(currentLine - 1).end(),
            '\n'
          )
          // Swap the lines
          editor.chain()
            .setTextSelection({ from: prevLineStart, to: currentLineEnd })
            .insertContent(currentLineContent + '\n' + prevLineContent)
            .setTextSelection({ from: prevLineStart, to: prevLineStart + currentLineContent.length })
            .run()
        }
      }
    } else if (e.altKey && !isMod && e.key === 'ArrowDown') {
      // Alt+Down: Move line down
      e.preventDefault()
      if (editor) {
        const { $from } = editor.state.selection
        const currentLineEnd = $from.after($from.depth)
        const docSize = editor.state.doc.content.size
        if (currentLineEnd < docSize - 1) {
          // Get the next line's position
          const nextLineEnd = editor.state.doc.resolve(currentLineEnd + 1).after($from.depth)
          const currentLineStart = $from.before($from.depth)
          const currentLineContent = editor.state.doc.textBetween($from.start(), $from.end(), '\n')
          const nextLineContent = editor.state.doc.textBetween(
            editor.state.doc.resolve(currentLineEnd + 1).start(),
            editor.state.doc.resolve(currentLineEnd + 1).end(),
            '\n'
          )
          // Swap the lines
          editor.chain()
            .setTextSelection({ from: currentLineStart, to: nextLineEnd })
            .insertContent(nextLineContent + '\n' + currentLineContent)
            .setTextSelection({
              from: currentLineStart + nextLineContent.length + 1,
              to: currentLineStart + nextLineContent.length + 1 + currentLineContent.length
            })
            .run()
        }
      }
    }
  }, [openFile, saveFile, setDialogOpen, setShortcutsDialogOpen, setModelPickerOpen, editor, setContext, setChatOpen, setFileListOpen, toggleChat, toggleFileList, isChatOpen, isFileListOpen, isFindOpen, openAddCommentDialog, openLinkPopover, cycleToolMode, toggleAnnotationsVisible])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Listen for menu:find event from main process (via App.tsx)
  useEffect(() => {
    const handleMenuFind = () => setIsFindOpen(true)
    window.addEventListener('menu:find', handleMenuFind)
    return () => window.removeEventListener('menu:find', handleMenuFind)
  }, [])

  // Listen for menu:addComment event from main process (via App.tsx)
  useEffect(() => {
    const handleMenuAddComment = () => openAddCommentDialog()
    window.addEventListener('menu:addComment', handleMenuAddComment)
    return () => window.removeEventListener('menu:addComment', handleMenuAddComment)
  }, [openAddCommentDialog])

  // Listen for menu:insertTable (#1060). Inserted with a header row, the only
  // shape tiptap-markdown serializes as a pipe table.
  useEffect(() => {
    const handleMenuInsertTable = () => {
      if (!editor || !editor.isEditable || useEditorStore.getState().sourceMode) return
      insertTable(editor)
    }
    window.addEventListener('menu:insertTable', handleMenuInsertTable)
    return () => window.removeEventListener('menu:insertTable', handleMenuInsertTable)
  }, [editor])

  // Listen for search:show event from tools (e.g., search_document)
  useEffect(() => {
    const handleSearchShow = () => setIsFindOpen(true)
    window.addEventListener('search:show', handleSearchShow)
    return () => window.removeEventListener('search:show', handleSearchShow)
  }, [])


  // Show empty state when document is empty, untitled, and user hasn't started editing
  const showEmptyState = !isEditing && !document.path && !document.content && !document.isDirty

  const pendingFrontmatter = useEditorStore((state) => state.pendingFrontmatter)

  // Check if document has frontmatter to display — uses stableFrontmatter so the
  // visibility decision doesn't flip during body edits. Also shows when there is a
  // pending AI suggestion even if the document has no existing frontmatter. On
  // editable docs without frontmatter, mount the FrontmatterEditor anyway so it
  // can render the "+ Add frontmatter" affordance (suppress for empty state,
  // read-only modes, and preview tabs).
  const showFrontmatter = useMemo(() => {
    if (pendingFrontmatter !== null) return true
    if (stableFrontmatter && Object.keys(stableFrontmatter).length > 0) return true
    if (hasFrontmatter(document.content)) return true
    if (!showEmptyState && !isRemarkableReadOnly && !isPreviewTab) return true
    return false
  }, [document.content, stableFrontmatter, pendingFrontmatter, showEmptyState, isRemarkableReadOnly, isPreviewTab])

  // Focus editor when transitioning from empty state to editing
  // (skip during preview tab navigation — editor is non-editable)
  useEffect(() => {
    if (!showEmptyState && editor && !isPreviewTab) {
      // Small delay to ensure editor is mounted and ready
      requestAnimationFrame(() => {
        editor.commands.focus()
      })
    }
  }, [showEmptyState, editor, isPreviewTab])

  // Source mode onChange handler: update state + store
  const handleSourceChange = useCallback((newContent: string) => {
    // A change flushed as the source editor unmounts for a document switch
    // belongs to the previous document; the store already holds the next one.
    if (useEditorStore.getState().document.documentId !== sourceDocIdRef.current) return
    latestSourceRef.current = newContent
    setSourceContent(newContent)
    // Source mode includes frontmatter — parse it out before saving to store
    const { content: body, frontmatter: fm } = parseMarkdown(newContent)
    sourceWriteRef.current = body
    setContent(body)
    useEditorStore.getState().setDocument({ frontmatter: fm })
  }, [setContent])

  // Frontmatter editor save handler: update store and content
  const setFrontmatter = useEditorStore((state) => state.setFrontmatter)
  const handleFrontmatterSave = useCallback((newFrontmatter: Record<string, unknown>) => {
    if (!editor) return
    setFrontmatter(newFrontmatter)
    setStableFrontmatter(newFrontmatter)
    // Clear frontmatterRef so onUpdate doesn't re-prepend raw frontmatter.
    // The store's document.frontmatter is the source of truth now;
    // buildSaveContent/serializeMarkdown adds the --- block on save.
    frontmatterRef.current = ''
    // Store body only
    const currentBody = editor.storage.markdown?.getMarkdown() ?? ''
    setContent(currentBody)
  }, [setFrontmatter, setContent, editor])

  const handleConfirmPasteAI = useCallback(() => {
    if (!pendingPasteAnnotation) return

    const activeDocumentId = useEditorStore.getState().document.documentId
    const activeEditor = useEditorInstanceStore.getState().editor
    if (activeDocumentId !== pendingPasteAnnotation.documentId || !activeEditor) {
      setPendingPasteAnnotation(null)
      return
    }

    const annotationTo = Math.min(
      pendingPasteAnnotation.to,
      activeEditor.state.doc.content.size
    )
    if (annotationTo > pendingPasteAnnotation.from) {
      const messageId = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      useAnnotationStore.getState().addAnnotation({
        documentId: pendingPasteAnnotation.documentId,
        type: 'insertion',
        from: pendingPasteAnnotation.from,
        to: annotationTo,
        content: pendingPasteAnnotation.text,
        provenance: {
          model: 'External AI',
          conversationId: 'paste',
          messageId,
        },
        explanation: 'Marked pasted text as AI-authored',
      })
    }

    setPendingPasteAnnotation(null)
    // Restore cursor to the end of the pasted range so the user can keep typing.
    focusEditorAtPasteEnd(annotationTo)
  }, [pendingPasteAnnotation])

  // Sets the session-level suppression flag and closes the dialog, so the AI-paste
  // prompt will not appear again until the app/window is restarted.
  const handleDismissThisSession = useCallback(() => {
    const toPos = pendingPasteAnnotation?.to ?? null
    pasteAnnotationDismissedThisSession = true
    setPendingPasteAnnotation(null)
    if (toPos !== null) {
      focusEditorAtPasteEnd(toPos)
    }
  }, [pendingPasteAnnotation])

  return (
    <div className="h-full flex flex-col relative">
      {/* Hide FindBar in source mode — CodeMirror has built-in Ctrl+F */}
      {!sourceMode && (
        <FindBar
          editor={editor}
          isOpen={isFindOpen}
          onClose={() => setIsFindOpen(false)}
        />
      )}
      {/* Share status ◎ (#769) — pinned to the document surface when the doc
          is published. FindBar owns this corner while open (D8). */}
      {webPlatformEnabled && shareEntry && !isFindOpen && !showEmptyState && (
        <div className="absolute right-3 top-2 z-10 flex flex-col items-end gap-2.5">
          <ShareStatusIcon />
          {sharePopoverOpen && <ShareStatusPopover />}
        </div>
      )}
      {showEmptyState ? (
        <EmptyState />
      ) : sourceMode ? (
        <div className="flex-1 overflow-auto px-12 py-6"
          style={{
            fontSize: `${settings.editor.fontSize}px`,
            lineHeight: settings.editor.lineHeight,
            fontFamily: settings.editor.fontFamily
          }}
        >
          <div className="max-w-3xl mx-auto">
            <SourceEditor
              ref={sourceEditorRef}
              content={sourceContent}
              onChange={handleSourceChange}
              fontSize={settings.editor.fontSize}
              lineHeight={settings.editor.lineHeight}
              fontFamily={settings.editor.fontFamily}
              isDark={effectiveTheme === 'dark'}
              readOnly={isRemarkableReadOnly || isPreviewTab}
            />
          </div>
        </div>
      ) : (
        <div
          className="flex-1 overflow-auto px-12 py-6"
          style={{
            fontSize: `${settings.editor.fontSize}px`,
            lineHeight: settings.editor.lineHeight,
            fontFamily: settings.editor.fontFamily
          }}
        >
          {/* reMarkable read-only indicator */}
          {isRemarkableReadOnly && !isTransforming && (
            <div className="max-w-3xl mx-auto mb-4 px-4 py-2 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground flex items-center justify-between">
              <span>Viewing reMarkable OCR (read-only)</span>
              <button
                className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={async () => {
                  // Start the animation
                  startTransform()

                  // Transform to editable version
                  const { remarkableNotebookId, setRemarkableReadOnly } = useEditorStore.getState()
                  const syncDir = useSettingsStore.getState().settings.remarkable?.syncDirectory
                  if (remarkableNotebookId && syncDir && window.api) {
                    const editablePath = await window.api.remarkableCreateEditableVersion(remarkableNotebookId, syncDir)
                    if (editablePath) {
                      // Clear read-only state first
                      setRemarkableReadOnly(false, null)

                      // Switch to File Explorer mode - notebooks panel is for reading cloud state,
                      // File Explorer is for editing
                      const { setViewMode, setRootPath, selectFile } = useFileListStore.getState()
                      setViewMode('folder')
                      setRootPath(syncDir)
                      selectFile(editablePath)

                      // Open the new editable file
                      const content = await window.api.readFile(editablePath)
                      if (content) {
                        const { parseMarkdown } = await import('../../lib/markdown')
                        const { generateIdFromPath } = await import('../../lib/persistence')
                        const parsed = parseMarkdown(content)
                        const newDocumentId = await generateIdFromPath(editablePath)
                        useEditorStore.getState().setDocument({
                          documentId: newDocumentId,
                          path: editablePath,
                          content: parsed.content,
                          frontmatter: parsed.frontmatter,
                          isDirty: false
                        })
                        useEditorStore.getState().setEditing(true)

                        // Set linkedNotebookId immediately to prevent CLS from async lookup
                        setLinkedNotebookId(remarkableNotebookId)
                      }
                    }
                  }
                }}
              >
                Edit
              </button>
            </div>
          )}
          {/* reMarkable editable indicator - show when editing a file linked to a notebook */}
          {!isRemarkableReadOnly && linkedNotebookId && !isTransforming && (
            <div className="max-w-3xl mx-auto mb-4 px-4 py-2 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground flex items-center justify-between">
              <span>Editing reMarkable notebook</span>
              <button
                className="text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                onClick={async () => {
                  // Start the animation
                  startTransform()

                  // Clear linkedNotebookId immediately to prevent CLS
                  const notebookIdToUse = linkedNotebookId
                  setLinkedNotebookId(null)

                  // Switch back to viewing OCR in Notebooks panel
                  const syncDir = useSettingsStore.getState().settings.remarkable?.syncDirectory
                  if (notebookIdToUse && syncDir && window.api) {
                    const ocrPath = await window.api.remarkableGetOCRPath(notebookIdToUse, syncDir)
                    if (ocrPath) {
                      // Switch to Notebooks panel
                      const { setViewMode, selectFile } = useFileListStore.getState()
                      setViewMode('notebooks')
                      selectFile(ocrPath)

                      // Set read-only mode
                      useEditorStore.getState().setRemarkableReadOnly(true, notebookIdToUse)

                      // Open the OCR file
                      const content = await window.api.readFile(ocrPath)
                      if (content) {
                        const { parseMarkdown } = await import('../../lib/markdown')
                        const { generateIdFromPath } = await import('../../lib/persistence')
                        const parsed = parseMarkdown(content)
                        const newDocumentId = await generateIdFromPath(ocrPath)
                        useEditorStore.getState().setDocument({
                          documentId: newDocumentId,
                          path: ocrPath,
                          content: parsed.content,
                          frontmatter: parsed.frontmatter,
                          isDirty: false
                        })
                      }
                    }
                  }
                }}
              >
                View Original
              </button>
            </div>
          )}
          <TransformAnimation isTransforming={isTransforming} onComplete={completeTransform}>
            <div className={`max-w-3xl mx-auto prose-editor ${isRemarkableReadOnly && !isTransforming ? 'opacity-80 select-none' : ''} ${!annotationsVisible ? 'hide-annotations' : ''}`}>
              {showFrontmatter && (
                isRemarkableReadOnly || isPreviewTab
                  ? <FrontmatterDisplay content={document.content} frontmatter={document.frontmatter} />
                  : <FrontmatterEditor key={document.documentId} frontmatter={stableFrontmatter} onSave={handleFrontmatterSave} />
              )}
              <EditorContent
                editor={editor}
                className="min-h-full"
              />
            </div>
          </TransformAnimation>
        </div>
      )}
      {!sourceMode && (
        <SelectionPopover
          editor={editor}
          onAddComment={openAddCommentDialog}
          onToggleLink={openLinkPopover}
        />
      )}
      {/* Table rails/grips. Hidden in source mode with the rest of the rich-text
          affordances, and the component itself bails when the editor is not
          editable (reMarkable OCR view, preview tabs). */}
      {!sourceMode && <TableControls editor={editor} />}
      <AddCommentDialog
        editor={editor}
        isOpen={isAddCommentOpen}
        selection={pendingCommentSelection}
        onClose={() => {
          setIsAddCommentOpen(false)
          setPendingCommentSelection(null)
        }}
      />
      <Dialog
        open={pendingPasteAnnotation !== null}
        onOpenChange={(open) => {
          if (!open) {
            // Handles Escape key and clicking the overlay — button-click paths
            // call setPendingPasteAnnotation(null) themselves and restore focus there.
            const toPos = pendingPasteAnnotation?.to ?? null
            setPendingPasteAnnotation(null)
            if (toPos !== null) {
              focusEditorAtPasteEnd(toPos)
            }
          }
        }}
      >
        <DialogContent
          className="sm:max-w-xl"
          onOpenAutoFocus={(e) => {
            // Radix focuses the first button ("Dismiss this Session") on open,
            // and after a keyboard paste that paints it with the focus-visible
            // ring — the least important action reads as selected. Focus the
            // dialog itself instead; Tab still reaches the buttons and Escape
            // still closes.
            e.preventDefault()
            ;(e.target as HTMLElement | null)?.focus()
          }}
          onCloseAutoFocus={(e) => {
            // Radix restores focus to the pre-open element AFTER close, which
            // runs later than our handlers' editor.focus() calls and strands
            // the caret outside the editor. Take over: the handlers have
            // already placed the selection; just re-enter the editor here.
            e.preventDefault()
            useEditorInstanceStore.getState().editor?.commands.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Mark pasted text as AI-authored?</DialogTitle>
            <DialogDescription>
              Save provenance for this pasted block in the document activity.
            </DialogDescription>
          </DialogHeader>
          {/* Three buttons in a mono font outgrow the default footer row —
              keep the dismiss action left, the decision pair right, and let
              the pair wrap to its own right-aligned row when space is tight. */}
          <DialogFooter className="sm:flex-wrap sm:gap-2 sm:space-x-0">
            <Button
              variant="ghost"
              onClick={handleDismissThisSession}
            >
              Dismiss this Session
            </Button>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:ml-auto">
              <Button
                variant="outline"
                onClick={() => {
                  const toPos = pendingPasteAnnotation?.to ?? null
                  setPendingPasteAnnotation(null)
                  if (toPos !== null) {
                    focusEditorAtPasteEnd(toPos)
                  }
                }}
              >
                Not now
              </Button>
              <Button onClick={handleConfirmPasteAI}>
                Mark as AI-authored
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {editor && <AISuggestionPopover editor={editor} />}
      {editor && <CommentPopover editor={editor} />}
      {editor && (
        <LinkPopover
          editor={editor}
          isOpen={linkPopover.isOpen}
          onClose={() => setLinkPopover(prev => ({ ...prev, isOpen: false }))}
          position={linkPopover.position}
          initialUrl={linkPopover.initialUrl}
        />
      )}
    </div>
  )
}
