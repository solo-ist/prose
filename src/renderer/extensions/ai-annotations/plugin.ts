/**
 * AI Annotations ProseMirror Plugin
 *
 * Creates time-fading gradient decorations for AI-generated text.
 * Uses inline decorations to highlight annotated ranges with opacity
 * that decreases over 7 days.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { Transaction } from '@tiptap/pm/state'
import type { AIAnnotation, AIAnnotationOptions } from '../../types/annotations'
import { calculateOpacity, formatAge, ANNOTATION_CONSTANTS } from '../../types/annotations'
import { useAnnotationStore } from './store'
import { anchorTextAt, nearestMatch, textIndex, type DocRange, type TextIndex } from './anchors'
import type { Node as PMNode } from '@tiptap/pm/model'

export const aiAnnotationsPluginKey = new PluginKey('aiAnnotations')

/**
 * Live annotations whose text no longer sits at their positions, with the
 * nearest place it does (#1138). A document that comes back re-parsed from
 * markdown (tab switch, relaunch) is a character or two shorter wherever the
 * serializer tidied text above a range, and the saved positions are applied
 * to it unchanged. An annotation whose text cannot be found is left where it
 * is: a wrong doc during a switch must not detach anything.
 */
function findMoves(doc: PMNode, annotations: AIAnnotation[]): Map<string, DocRange> {
  const moves = new Map<string, DocRange>()
  let index: TextIndex | null = null
  const maxPos = doc.content.size
  for (const a of annotations) {
    if (a.detached || !a.anchorText || a.from < 0 || a.from >= a.to) continue
    const inBounds = a.to <= maxPos
    if (inBounds && anchorTextAt(doc, a.from, a.to) === a.anchorText) continue
    index ??= textIndex(doc)
    const match = nearestMatch(index, a.anchorText, a.from)
    if (match && (match.from !== a.from || match.to !== a.to)) moves.set(a.id, match)
  }
  return moves
}

// Track tooltip element for cleanup
let activeTooltip: HTMLElement | null = null


function removeTooltip() {
  if (activeTooltip) {
    activeTooltip.remove()
    activeTooltip = null
  }
}

function showTooltip(annotation: AIAnnotation, event: MouseEvent) {
  removeTooltip()

  const tooltip = document.createElement('div')
  tooltip.className = 'ai-annotation-tooltip'

  const ageString = formatAge(annotation.createdAt)
  const typeLabel =
    annotation.type === 'insertion'
      ? 'AI Insertion'
      : annotation.type === 'deletion'
        ? 'AI Deletion'
        : 'AI Replacement'

  const header = document.createElement('div')
  header.className = 'ai-annotation-tooltip-header'
  header.textContent = typeLabel

  const model = document.createElement('div')
  model.className = 'ai-annotation-tooltip-model'
  model.textContent = annotation.provenance.model

  const time = document.createElement('div')
  time.className = 'ai-annotation-tooltip-time'
  time.textContent = ageString

  tooltip.append(header, model, time)

  const explanationText = annotation.explanation?.trim()
  if (explanationText) {
    const explanation = document.createElement('div')
    explanation.className = 'ai-annotation-tooltip-explanation'
    explanation.textContent = explanationText
    tooltip.appendChild(explanation)
  }

  // Position near cursor
  tooltip.style.left = `${event.clientX + 10}px`
  tooltip.style.top = `${event.clientY + 10}px`

  document.body.appendChild(tooltip)
  activeTooltip = tooltip

  // Adjust if tooltip goes off screen
  const rect = tooltip.getBoundingClientRect()
  if (rect.right > window.innerWidth) {
    tooltip.style.left = `${event.clientX - rect.width - 10}px`
  }
  if (rect.bottom > window.innerHeight) {
    tooltip.style.top = `${event.clientY - rect.height - 10}px`
  }
}

export interface AIAnnotationsPluginState {
  decorationSet: DecorationSet
  annotations: AIAnnotation[]
  lastRefresh: number
}

export function createAIAnnotationsPlugin(options: AIAnnotationOptions = {}) {
  const opts: Required<AIAnnotationOptions> = {
    className: options.className ?? 'ai-annotation',
    maxAge: options.maxAge ?? ANNOTATION_CONSTANTS.MAX_AGE_MS,
    showTooltip: options.showTooltip ?? true,
    onAnnotationClick: options.onAnnotationClick ?? (() => {}),
  }

  // Track annotation state - subscription happens lazily in view()
  let currentAnnotations: AIAnnotation[] = []
  let isVisible = true
  let unsubscribe: (() => void) | null = null
  /** The store array and the doc the anchors were last checked against (#1138). */
  let reconciledAnnotations: AIAnnotation[] | null = null
  let reconciledDoc: PMNode | null = null

  return new Plugin({
    key: aiAnnotationsPluginKey,

    state: {
      init(_, { doc }) {
        // Get initial state from store
        const state = useAnnotationStore.getState()
        currentAnnotations = state.annotations
        isVisible = state.isVisible
        const createdThisSession = state.createdThisSession

        const decorations: Decoration[] = []

        if (isVisible) {
          for (const annotation of currentAnnotations) {
            // Detached annotations are history-only (#674) — no decoration,
            // and their stale positions must not hit the bounds warning.
            if (annotation.detached) continue
            if (annotation.from < 0 || annotation.to > doc.nodeSize - 2 || annotation.from >= annotation.to) {
              console.warn('[AIAnnotations:plugin] Skipping invalid annotation (init):', {
                id: annotation.id,
                from: annotation.from,
                to: annotation.to,
                docSize: doc.nodeSize,
                maxValidTo: doc.nodeSize - 2,
                reason: annotation.from < 0 ? 'negative from' :
                        annotation.to > doc.nodeSize - 2 ? `to (${annotation.to}) exceeds max (${doc.nodeSize - 2})` :
                        `from (${annotation.from}) >= to (${annotation.to})`
              })
              continue
            }

            const opacity = calculateOpacity(annotation.createdAt, opts.maxAge)

            decorations.push(
              Decoration.inline(annotation.from, annotation.to, {
                class: `ai-annotation ai-annotation-${annotation.type}`,
                style: `--annotation-opacity: ${opacity.toFixed(3)}`,
                'data-annotation-id': annotation.id,
                'data-annotation-type': annotation.type,
                'data-annotation-model': annotation.provenance.model,
                'data-annotation-age': formatAge(annotation.createdAt),
              })
            )
          }
        }

        return {
          decorationSet: DecorationSet.create(doc, decorations),
          annotations: currentAnnotations,
          lastRefresh: Date.now(),
        }
      },

      apply(tr: Transaction, pluginState: AIAnnotationsPluginState, _oldState, newState) {
        const { doc } = newState

        // Get latest from store
        const storeState = useAnnotationStore.getState()
        const storeAnnotations = storeState.annotations
        const storeVisible = storeState.isVisible

        // Check if we need to rebuild decorations
        const annotationsChanged = storeAnnotations !== pluginState.annotations
        const visibilityChanged = storeVisible !== isVisible
        const needsRefresh = Date.now() - pluginState.lastRefresh > ANNOTATION_CONSTANTS.REFRESH_INTERVAL_MS
        // Explicit force-rebuild signal (e.g. after a tab switch re-loads annotations
        // for the current document). Guarantees decorations rebuild from the store
        // even if the annotations array reference happens to match.
        const forceRebuild = tr.getMeta(aiAnnotationsPluginKey)?.rebuildDecorations === true

        isVisible = storeVisible

        // If document changed, map positions
        let decorationSet = pluginState.decorationSet
        if (tr.docChanged) {
          decorationSet = decorationSet.map(tr.mapping, doc)

          // Also update annotation positions in store
          if (storeAnnotations.length > 0) {
            // Collect insertions (typing inside annotations should split them)
            const insertions: Array<{ pos: number; length: number }> = []

            for (const step of tr.steps) {
              if (step instanceof ReplaceStep) {
                const replaceStep = step as ReplaceStep
                // Pure insertion: from === to with content
                if (replaceStep.from === replaceStep.to && replaceStep.slice.content.size > 0) {
                  insertions.push({
                    pos: replaceStep.from,
                    length: replaceStep.slice.content.size,
                  })
                }
              }
            }

            // Use splitting-aware position update if there are insertions
            if (insertions.length > 0) {
              useAnnotationStore.getState().updatePositionsWithSplitting(
                (pos, bias) => tr.mapping.map(pos, bias),
                insertions
              )
            } else {
              // No insertions, use simple position mapping
              useAnnotationStore.getState().updatePositions((from, to) => {
                try {
                  const mappedFrom = tr.mapping.map(from, 1)
                  const mappedTo = tr.mapping.map(to, -1)

                  if (mappedFrom >= mappedTo) {
                    return null
                  }

                  return { from: mappedFrom, to: mappedTo }
                } catch {
                  return null
                }
              })
            }
          }
        }

        // Anchor text (#1138). On a document change the mapped positions are
        // right by construction, so the text under them is what each range
        // means from now on. On any other transaction the positions may be
        // the ones a reload brought back against re-parsed text, so check
        // them against the anchors once per store array and move the ranges
        // the text has left. Both wait out a document load: the store may
        // hold the next tab's annotations while the editor still shows this
        // one.
        const loading = storeState.isLoadingDocument
        const maxPos = doc.content.size
        const textAt = (from: number, to: number) => (to <= maxPos ? anchorTextAt(doc, from, to) : null)
        if (!loading) {
          if (tr.docChanged) {
            useAnnotationStore.getState().refreshAnchorText(textAt)
          } else if (doc !== reconciledDoc || useAnnotationStore.getState().annotations !== reconciledAnnotations) {
            // A new doc object without a transaction is a fresh EditorState
            // (a tab switch, a relaunch): the case this exists for.
            const moves = findMoves(doc, useAnnotationStore.getState().annotations)
            if (moves.size > 0) useAnnotationStore.getState().reanchorAnnotations(moves)
            useAnnotationStore.getState().refreshAnchorText(textAt, true)
          }
          reconciledAnnotations = useAnnotationStore.getState().annotations
          reconciledDoc = doc
        }
        const liveAnnotations = useAnnotationStore.getState().annotations

        // Rebuild decorations if needed
        if (annotationsChanged || visibilityChanged || needsRefresh || tr.docChanged || forceRebuild || liveAnnotations !== storeAnnotations) {
          const decorations: Decoration[] = []
          const createdThisSession = storeState.createdThisSession

          if (isVisible) {
            for (const annotation of liveAnnotations) {
              // Detached annotations are history-only (#674) — no decoration,
              // and their stale positions must not hit the bounds warning.
              if (annotation.detached) continue
              // Validate bounds
              const maxPos = doc.nodeSize - 2
              if (annotation.from < 0 || annotation.to > maxPos || annotation.from >= annotation.to) {
                console.warn('[AIAnnotations:plugin] Skipping invalid annotation (apply):', {
                  id: annotation.id,
                  from: annotation.from,
                  to: annotation.to,
                  docSize: doc.nodeSize,
                  maxValidTo: maxPos,
                  reason: annotation.from < 0 ? 'negative from' :
                          annotation.to > maxPos ? `to (${annotation.to}) exceeds max (${maxPos})` :
                          `from (${annotation.from}) >= to (${annotation.to})`
                })
                continue
              }

              const opacity = calculateOpacity(annotation.createdAt, opts.maxAge)

              decorations.push(
                Decoration.inline(annotation.from, annotation.to, {
                  class: `ai-annotation ai-annotation-${annotation.type}`,
                  style: `--annotation-opacity: ${opacity.toFixed(3)}`,
                  'data-annotation-id': annotation.id,
                  'data-annotation-type': annotation.type,
                  'data-annotation-model': annotation.provenance.model,
                  'data-annotation-age': formatAge(annotation.createdAt),
                })
              )
            }
          }

          return {
            decorationSet: DecorationSet.create(doc, decorations),
            annotations: liveAnnotations,
            lastRefresh: needsRefresh ? Date.now() : pluginState.lastRefresh,
          }
        }

        return {
          ...pluginState,
          decorationSet,
        }
      },
    },

    props: {
      decorations(state) {
        const pluginState = aiAnnotationsPluginKey.getState(state) as AIAnnotationsPluginState | undefined
        return pluginState?.decorationSet ?? DecorationSet.empty
      },

      handleDOMEvents: {
        mouseover(_view, event) {
          if (!opts.showTooltip) return false

          const target = event.target as HTMLElement
          const annotationEl = target.closest('.ai-annotation')

          if (annotationEl) {
            const annotationId = annotationEl.getAttribute('data-annotation-id')
            if (annotationId) {
              const annotation = currentAnnotations.find((a) => a.id === annotationId)
              if (annotation) {
                showTooltip(annotation, event)
              }
            }
          }

          return false
        },

        mouseout(_view, event) {
          const target = event.target as HTMLElement
          const relatedTarget = event.relatedTarget as HTMLElement | null

          // Only remove tooltip if we're leaving the annotation area
          if (target.closest('.ai-annotation') && !relatedTarget?.closest('.ai-annotation')) {
            removeTooltip()
          }

          return false
        },

        click(_view, event) {
          const target = event.target as HTMLElement
          const annotationEl = target.closest('.ai-annotation')

          if (annotationEl) {
            const annotationId = annotationEl.getAttribute('data-annotation-id')
            if (annotationId) {
              const annotation = currentAnnotations.find((a) => a.id === annotationId)
              if (annotation && opts.onAnnotationClick) {
                opts.onAnnotationClick(annotation)
              }
            }
          }

          return false
        },
      },
    },

    view(editorView) {
      // Subscribe when plugin view is created (after DB init). Decorations are
      // derived from the store, so whenever annotations (or visibility) change —
      // a new edit is marked, one is removed, or a tab switch re-loads them — we
      // must trigger a rebuild. apply() only re-derives on a transaction, and a
      // bare store mutation isn't one, so we dispatch a force-rebuild meta tx.
      //
      // The dispatch is deferred via queueMicrotask and coalesced behind a flag:
      // store mutations can occur *inside* apply() (updatePositions on docChanged),
      // and dispatching synchronously there would nest dispatches. Deferring runs
      // the rebuild after the current dispatch settles. The rebuild path
      // mutates the store at most once per store array (the #1138 anchor
      // check), and the rebuild that mutation schedules finds the array
      // already checked, so it can't loop.
      //
      // The end of a document load is a trigger too: the anchor check waits
      // it out, and the loaded set may otherwise sit unchecked until the
      // next transaction.
      let lastAnnotations = useAnnotationStore.getState().annotations
      let lastVisible = useAnnotationStore.getState().isVisible
      let lastLoading = useAnnotationStore.getState().isLoadingDocument
      let rebuildScheduled = false

      unsubscribe = useAnnotationStore.subscribe((state) => {
        currentAnnotations = state.annotations
        isVisible = state.isVisible

        const loadEnded = lastLoading && !state.isLoadingDocument
        const changed = state.annotations !== lastAnnotations || state.isVisible !== lastVisible || loadEnded
        lastAnnotations = state.annotations
        lastVisible = state.isVisible
        lastLoading = state.isLoadingDocument
        if (!changed || rebuildScheduled) return

        rebuildScheduled = true
        queueMicrotask(() => {
          rebuildScheduled = false
          if (editorView.isDestroyed) return
          editorView.dispatch(
            editorView.state.tr.setMeta(aiAnnotationsPluginKey, { rebuildDecorations: true })
          )
        })
      })

      return {
        destroy() {
          removeTooltip()
          unsubscribe?.()
        },
      }
    },
  })
}
