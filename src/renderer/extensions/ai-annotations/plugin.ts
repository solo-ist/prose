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

export const aiAnnotationsPluginKey = new PluginKey('aiAnnotations')

// Track tooltip element for cleanup
let activeTooltip: HTMLElement | null = null

// Track annotations that have already animated (to prevent re-triggering on decoration rebuild)
const hasAnimated = new Set<string>()
let lastDocumentId: string | null = null

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
  const typeLabel = annotation.type === 'insertion' ? 'AI Insertion' : 'AI Replacement'

  tooltip.innerHTML = `
    <div class="ai-annotation-tooltip-header">${typeLabel}</div>
    <div class="ai-annotation-tooltip-model">${annotation.provenance.model}</div>
    <div class="ai-annotation-tooltip-time">${ageString}</div>
  `

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
            if (opacity < ANNOTATION_CONSTANTS.MIN_OPACITY) continue

            // Only animate annotations loaded from storage that haven't animated yet
            const shouldAnimate = !createdThisSession.has(annotation.id) && !hasAnimated.has(annotation.id)
            const animateClass = shouldAnimate ? ' animate-in' : ''
            if (shouldAnimate) {
              hasAnimated.add(annotation.id)
            }

            decorations.push(
              Decoration.inline(annotation.from, annotation.to, {
                class: `ai-annotation ai-annotation-${annotation.type}${animateClass}`,
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

        // Clear animation tracking when document changes
        if (storeState.documentId !== lastDocumentId) {
          hasAnimated.clear()
          lastDocumentId = storeState.documentId
        }

        // Check if we need to rebuild decorations
        const annotationsChanged = storeAnnotations !== pluginState.annotations
        const visibilityChanged = storeVisible !== isVisible
        const needsRefresh = Date.now() - pluginState.lastRefresh > ANNOTATION_CONSTANTS.REFRESH_INTERVAL_MS

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

        // Rebuild decorations if needed
        if (annotationsChanged || visibilityChanged || needsRefresh || tr.docChanged) {
          const decorations: Decoration[] = []
          const createdThisSession = storeState.createdThisSession

          if (isVisible) {
            for (const annotation of storeAnnotations) {
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
              if (opacity < ANNOTATION_CONSTANTS.MIN_OPACITY) continue

              // Only animate annotations loaded from storage that haven't animated yet
              const shouldAnimate = !createdThisSession.has(annotation.id) && !hasAnimated.has(annotation.id)
              const animateClass = shouldAnimate ? ' animate-in' : ''
              if (shouldAnimate) {
                hasAnimated.add(annotation.id)
              }

              decorations.push(
                Decoration.inline(annotation.from, annotation.to, {
                  class: `ai-annotation ai-annotation-${annotation.type}${animateClass}`,
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
            annotations: storeAnnotations,
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

    view() {
      // Subscribe when plugin view is created (after DB init)
      unsubscribe = useAnnotationStore.subscribe((state) => {
        currentAnnotations = state.annotations
        isVisible = state.isVisible
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
