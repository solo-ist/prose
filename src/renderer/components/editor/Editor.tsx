import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useEditor as useTipTapEditor, EditorContent } from '@tiptap/react'
import { EditorState } from '@tiptap/pm/state'
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
import { AISuggestion } from '../../extensions/ai-suggestions'
import { useSuggestionStore } from '../../extensions/ai-suggestions/store'
import { useReviewEventStore, createReviewEvent, type ReviewActor } from '../../extensions/review-events'
import { SESSION_ID } from '../../lib/persistence'
import { AIAnnotations, useAnnotationStore } from '../../extensions/ai-annotations'
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
import { useTabStore } from '../../stores/tabStore'
import { promoteCurrentPreview } from '../../hooks/useTabs'
import { FindBar } from './FindBar'
import { SelectionPopover } from './SelectionPopover'
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
import type { AISuggestionData, SuggestionFeedback } from '../../extensions/ai-suggestions/types'
import { useCommentStore } from '../../extensions/comments/store'
import { LinkPopover } from './LinkPopover'
import { SourceEditor, SourceEditorHandle } from './SourceEditor'
import { getApi } from '../../lib/browserApi'
import { isMcpAttributionLabel } from '../../../shared/tools/mcpClientIdentity'

const AI_PASTE_PROMPT_MIN_CHARS = 200

interface PendingPasteAnnotation {
  documentId: string
  from: number
  to: number
  text: string
}

function shouldPromptForAIPaste(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return trimmed.length >= AI_PASTE_PROMPT_MIN_CHARS || trimmed.includes('\n')
}

function actorForSuggestion(suggestion: AISuggestionData): ReviewActor {
  const source = suggestion.provenanceSource ?? (
    isMcpAttributionLabel(suggestion.provenanceModel) ? 'mcp' :
      suggestion.provenanceModel ? 'chat' : 'system'
  )
  return {
    kind: 'agent',
    source,
    model: suggestion.provenanceModel || undefined,
    conversationId: suggestion.provenanceConversationId || undefined,
    messageId: suggestion.provenanceMessageId || undefined,
    invocationId: suggestion.provenanceInvocationId || undefined,
  }
}

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
  const reviewDisplayMode = useEditorStore((state) => state.reviewDisplayMode)
  const sourceMode = useEditorStore((state) => state.sourceMode)
  const setSourceMode = useEditorStore((state) => state.setSourceMode)
  const { settings, effectiveTheme, setDialogOpen, setShortcutsDialogOpen, setModelPickerOpen } = useSettings()
  const { setContext, cycleToolMode } = useChat()
  const { isChatOpen, isFileListOpen, toggleChat, toggleFileList, setChatOpen, setFileListOpen } = usePanelLayoutContext()
  const setEditorInstance = useEditorInstanceStore((state) => state.setEditor)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUpdatingFromStore = useRef(false)
  const frontmatterRef = useRef<string>('')
  const lastDocumentIdRef = useRef<string>(document.documentId)
  const [isFindOpen, setIsFindOpen] = useState(false)
  const [isAddCommentOpen, setIsAddCommentOpen] = useState(false)
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
  const stableFrontmatterDocIdRef = useRef<string>(document.documentId)

  useEffect(() => {
    const next = document.frontmatter ?? {}
    if (stableFrontmatterDocIdRef.current !== document.documentId) {
      stableFrontmatterDocIdRef.current = document.documentId
      setStableFrontmatter(next)
      return
    }
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
  }, [document.documentId, document.frontmatter, stableFrontmatter])

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
      TaskList,
      TaskItem.configure({
        nested: true
      }),
      Footnotes,
      Footnote,
      FootnoteReference,
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: '-',
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
          if (store.documentId) {
            useReviewEventStore.getState().appendEvent(createReviewEvent({
              documentId: store.documentId,
              target: 'comment',
              targetId: commentData.id,
              kind: 'created',
              actor: {
                kind: commentData.author === 'ai' ? 'agent' : 'user',
                source: commentData.author === 'ai' ? 'chat' : 'ui',
              },
              payload: {
                comment: commentData.comment,
                markedText: commentData.markedText,
              },
            }))
          }
        },
        onCommentRemoved: (id) => {
          const documentId = useCommentStore.getState().documentId
          if (!documentId) return
          useReviewEventStore.getState().appendEvent(createReviewEvent({
            documentId,
            target: 'comment',
            targetId: id,
            kind: 'resolved',
            actor: { kind: 'user', source: 'ui' },
          }))
        },
      }),
      AISuggestion.configure({
        onSuggestionAdded: (suggestion) => {
          useSuggestionStore.getState().recordSuggestionAdded(
            suggestion,
            actorForSuggestion(suggestion),
          )
        },
        onSuggestionFeedback: (suggestion, feedback: SuggestionFeedback) => {
          const store = useSuggestionStore.getState()
          store.recordSuggestionFeedback(suggestion, feedback)
          // Keep the active mark's userReply in sync with history for UI
          // feedback too. This is intentionally fire-and-forget: the store's
          // persistence layer reports failures and the editor interaction
          // should remain responsive.
          const activeEditor = useEditorInstanceStore.getState().editor
          const activeDocumentId = useEditorStore.getState().document.documentId
          if (activeEditor && activeDocumentId) {
            void store.saveSuggestions(activeDocumentId, getAISuggestions(activeEditor))
          }
        },
        onSuggestionAccepted: (suggestion, actor) => {
          useSuggestionStore.getState().recordSuggestionDecision(suggestion, 'accepted', actor)
        },
        onSuggestionRejected: (suggestion, actor) => {
          useSuggestionStore.getState().recordSuggestionDecision(suggestion, 'rejected', actor)
        },
      }),
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
        class: 'outline-none min-h-full'
      },
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

          if (annotationTo > selectionFrom) {
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

      console.log('[Editor:onUpdate] Content changed, scheduling save')

      // Capture the current document ID so we can discard the update if the
      // user switches tabs before the debounce fires (prevents cross-tab dirty state)
      const capturedDocumentId = useEditorStore.getState().document.documentId

      // Debounce content updates to store
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        // If the active document changed since this was scheduled (tab switch),
        // discard the update to avoid marking the wrong tab as dirty
        if (useEditorStore.getState().document.documentId !== capturedDocumentId) {
          console.log('[Editor:onUpdate] Document changed, discarding stale content update')
          return
        }

        const markdown = editor.storage.markdown.getMarkdown()
        // Prepend frontmatter if present
        const fullContent = frontmatterRef.current + markdown
        console.log('[Editor:onUpdate] Saving content to store:', {
          length: fullContent.length,
          preview: fullContent.substring(0, 100).replace(/\n/g, '\\n'),
          hasTable: fullContent.includes('|')
        })
        setContent(fullContent)
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
    }

    // Check if body content differs (comparing without frontmatter)
    if (newBody !== currentMarkdown) {
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
      } else {
        // Normal content update - preserve history so user can undo their edits
        editor.commands.setContent(newBody)
      }

      isUpdatingFromStore.current = false

      // The setContent/updateState above dispatched the document-load transaction
      // which correctly skipped position updates (isLoadingDocument was true). Now
      // that the load transaction has fired, clear the guard immediately so the
      // NEXT user-initiated transaction (e.g. accept_diff) runs updatePositions.
      // The 100ms setTimeout in select_tab / executeOpenFile remains as a fallback
      // for tab switches where content didn't change.
      useAnnotationStore.getState().setLoadingDocument(false)

      // Scroll to top when new content is loaded
      const editorContainer = editor.view.dom.closest('.overflow-auto')
      if (editorContainer) {
        editorContainer.scrollTop = 0
      }
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
    return () => {
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
        const restored = editor.commands.restoreAISuggestions(pendingSuggestions)
        // Keep unresolved records available for a later content/anchor
        // update. Clearing them after a failed replay made the durable store
        // say "pending" while the editor had no reviewable mark.
        if (restored) useSuggestionStore.getState().clearSuggestions()
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
    const persist = () => {
      timer = null
      const store = useSuggestionStore.getState()
      if (store.pendingSuggestions.length > 0) return // restore pending — don't clobber
      const live = getAISuggestions(editor)
      // NEVER overwrite the stored set with an empty one from a routine
      // transaction. An empty editor here is almost always transient — a
      // document load or a source-mode toggle strips the decorations and fires a
      // transaction — NOT a real "user cleared all". Persisting that empty wiped
      // suggestions from IndexedDB (data loss). Mirrors useTabs' deliberate
      // `length > 0 ? save : skip`; genuine empties persist via tab-switch/delete.
      if (live.length === 0) return
      store.saveSuggestions(docId, live)
    }
    const onTx = () => {
      if (timer) clearTimeout(timer)
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
      const commentStore = useCommentStore.getState()
      commentStore.setDocumentId(document.documentId)
      commentStore.loadComments(document.documentId)
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
      return
    }

    const shouldShowEmptyState = !isEditing && !document.path && !document.content && !document.isDirty
    if (editor && !shouldShowEmptyState) {
      hasFocusedRef.current = true
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
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
      const md = editor.storage.markdown?.getMarkdown?.() ?? ''
      const fm = useEditorStore.getState().document.frontmatter ?? {}
      setSourceContent(serializeMarkdown(md, fm))
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
      // Source → WYSIWYG: parse frontmatter back out from raw source
      const liveContent = sourceEditorRef.current?.getContent() ?? sourceContent
      const { content: bodyOnly, frontmatter: parsedFm } = parseMarkdown(liveContent)
      useEditorStore.getState().setFrontmatter(parsedFm)
      editor.commands.setContent(bodyOnly)
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
      setIsFindOpen(true)
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
    setSourceContent(newContent)
    // Source mode includes frontmatter — parse it out before saving to store
    const { content: body, frontmatter: fm } = parseMarkdown(newContent)
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
            <div
              className={`max-w-3xl mx-auto prose-editor review-display-${reviewDisplayMode} ${isRemarkableReadOnly && !isTransforming ? 'opacity-80 select-none' : ''} ${!annotationsVisible ? 'hide-annotations' : ''}`}
              data-review-display-mode={reviewDisplayMode}
            >
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
          if (!open) setPendingPasteAnnotation(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark pasted text as AI-authored?</DialogTitle>
            <DialogDescription>
              Save provenance for this pasted block in the document activity.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingPasteAnnotation(null)}>
              Not now
            </Button>
            <Button onClick={handleConfirmPasteAI}>
              Mark as AI-authored
            </Button>
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
