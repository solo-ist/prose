/**
 * AI Annotations ProseMirror Plugin
 *
 * Owns the AI annotation records of its document (#1146) and paints them as
 * time-fading inline decorations (opacity decreasing over 7 days).
 *
 * `apply` is the one place the record set changes: records are mapped
 * through the transaction (split around text typed inside them, detached on
 * collapse, never deleted, #674) or, across a whole-document replace, put
 * back on their text (the source-mode exit and its undo, a disk reload's
 * seed, #1138); then the transaction's metas run (load, removeRange, remove,
 * add); an identity change restamps every record; and the anchors are
 * refreshed from the document being applied, so a record can never carry
 * another document's text. The session layer persists the set by watching
 * the state's `revision` (document/session.ts).
 */

import { Plugin } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { AIAnnotation, AIAnnotationOptions } from '../../types/annotations'
import { actorLabel, actorOfProvenance } from '../../../shared/review/actor'
import { calculateOpacity, formatAge, ANNOTATION_CONSTANTS } from '../../types/annotations'
import { getIdentity, IDENTITY_META, RELOAD_META } from '../../document/identity'
import { pipelineLog } from '../../lib/aiPipelineLog'
import {
  aiAnnotationsPluginKey,
  EMPTY_ANNOTATIONS,
  type AIAnnotationsPluginState,
  type AnnotationMeta
} from './transactions'
import {
  isWholeDocumentReplace,
  loadRecords,
  mapRecords,
  reanchorRecords,
  refreshAnchors,
  removeRecordsInRange,
  restampRecords,
  stampAdded
} from './records'

export { aiAnnotationsPluginKey } from './transactions'
export type { AIAnnotationsPluginState } from './transactions'

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
  // Who proposed the text (#1232), not a bare model id.
  model.textContent = actorLabel(actorOfProvenance(annotation.provenance.model, annotation.provenance.actor))

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

function buildDecorations(doc: PMNode, records: readonly AIAnnotation[], maxAge: number): DecorationSet {
  const decorations: Decoration[] = []
  const maxPos = doc.content.size
  for (const annotation of records) {
    // Detached annotations are history-only (#674): no decoration, and their
    // stale positions must not hit the bounds check. A zero-width record
    // (an AI deletion marker) has nothing to paint.
    if (annotation.detached) continue
    if (annotation.from < 0 || annotation.to > maxPos || annotation.from >= annotation.to) continue
    const opacity = calculateOpacity(annotation.createdAt, maxAge)
    decorations.push(
      Decoration.inline(annotation.from, annotation.to, {
        class: `ai-annotation ai-annotation-${annotation.type}`,
        style: `--annotation-opacity: ${opacity.toFixed(3)}`,
        'data-annotation-id': annotation.id,
        'data-annotation-type': annotation.type,
        'data-annotation-model': annotation.provenance.model,
        'data-annotation-age': formatAge(annotation.createdAt)
      })
    )
  }
  return DecorationSet.create(doc, decorations)
}

function logDetached(detached: readonly AIAnnotation[], reason: string): void {
  for (const a of detached) pipelineLog('annotation:detach', { id: a.id, from: a.from, to: a.to, reason })
}

function logMoved(moved: readonly AIAnnotation[], before: ReadonlyMap<string, AIAnnotation>, via: string): void {
  for (const a of moved) {
    const prev = before.get(a.id)
    pipelineLog('annotation:reanchor', { id: a.id, from: prev?.from, to: prev?.to, newFrom: a.from, newTo: a.to, via })
  }
}

export function createAIAnnotationsPlugin(options: AIAnnotationOptions = {}) {
  const opts: Required<AIAnnotationOptions> = {
    className: options.className ?? 'ai-annotation',
    maxAge: options.maxAge ?? ANNOTATION_CONSTANTS.MAX_AGE_MS,
    showTooltip: options.showTooltip ?? true,
    onAnnotationClick: options.onAnnotationClick ?? (() => {})
  }

  return new Plugin<AIAnnotationsPluginState>({
    key: aiAnnotationsPluginKey,

    state: {
      // Every state starts empty; records arrive through a `load` meta on the
      // session's seed transaction (document/session.ts).
      init() {
        return {
          records: EMPTY_ANNOTATIONS,
          decorations: DecorationSet.empty,
          lastRefresh: Date.now(),
          revision: 0,
          urgentRevision: 0
        }
      },

      apply(tr: Transaction, prev, oldState, newState) {
        const doc = newState.doc
        // The identity plugin runs first (priority 1000), so this is the
        // document's own id, a rename included.
        const { documentId } = getIdentity(newState)
        const meta = tr.getMeta(aiAnnotationsPluginKey) as AnnotationMeta | undefined
        let records = prev.records
        let urgent = false
        // The old decorations cannot be mapped through a whole-document
        // replace (every range collapses); they are rebuilt from the records
        // even when no record moved.
        let repaint = false

        if (tr.docChanged && records.length > 0) {
          if (tr.getMeta(RELOAD_META) === true || isWholeDocumentReplace(tr)) {
            // A whole-document replace: the source-mode exit, its undo or
            // redo, a select-all paste. Mapping through it collapses every
            // range; carry the records over by their text instead.
            const before = new Map(records.map((a) => [a.id, a]))
            const result = reanchorRecords(records, oldState.doc, doc)
            logMoved(result.moved, before, 'reload')
            logDetached(result.detached, 'reload-miss')
            records = result.records
            repaint = true
            if (result.moved.length > 0 || result.detached.length > 0) urgent = true
          } else {
            const result = mapRecords(records, tr)
            logDetached(result.detached, result.split > 0 ? 'split-collapse' : 'mapping-collapse')
            records = result.records
            if (result.detached.length > 0 || result.split > 0) urgent = true
          }
        }

        if (meta) {
          if (meta.load) {
            const before = new Map(meta.load.map((a) => [a.id, a]))
            const result = loadRecords(meta.load, doc, documentId)
            logMoved(result.moved, before, 'load')
            logDetached(result.detached, 'load-miss')
            // A seed is not a change to write back: the session marks the
            // loaded revision as persisted.
            records = result.records
          }
          for (const range of meta.removeRange ?? []) {
            const next = removeRecordsInRange(records, range.from, range.to, doc)
            if (next !== records) {
              records = next
              urgent = true
            }
          }
          if (meta.remove && meta.remove.length > 0) {
            const ids = new Set(meta.remove)
            const next = records.filter((a) => !ids.has(a.id))
            if (next.length !== records.length) {
              records = next
              urgent = true
            }
          }
          if (meta.add && meta.add.length > 0) {
            const added = stampAdded(meta.add, doc, documentId)
            // An add that reuses an existing id supersedes that record: a
            // prior annotation carried over onto its unchanged words by an
            // AI edit (buildWordDiffAnnotations) moves instead of leaving a
            // detached entry beside a copy.
            const ids = new Set(added.map((a) => a.id))
            const kept = records.some((a) => ids.has(a.id)) ? records.filter((a) => !ids.has(a.id)) : records
            records = [...kept, ...added]
            urgent = true
          }
        }

        if (tr.getMeta(IDENTITY_META)) {
          const next = restampRecords(records, documentId)
          if (next !== records) {
            records = next
            urgent = true
          }
        }

        if (tr.docChanged || meta) records = refreshAnchors(records, doc)

        const changed = records !== prev.records
        const needsRefresh = Date.now() - prev.lastRefresh > ANNOTATION_CONSTANTS.REFRESH_INTERVAL_MS
        if (!changed && !needsRefresh && !tr.docChanged) return prev

        const decorations =
          changed || needsRefresh || repaint
            ? buildDecorations(doc, records, opts.maxAge)
            : prev.decorations.map(tr.mapping, doc)
        const revision = changed ? prev.revision + 1 : prev.revision
        return {
          records,
          decorations,
          lastRefresh: needsRefresh ? Date.now() : prev.lastRefresh,
          revision,
          urgentRevision: changed && urgent ? revision : prev.urgentRevision
        }
      }
    },

    props: {
      decorations(state) {
        return aiAnnotationsPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      },

      handleDOMEvents: {
        mouseover(view, event) {
          if (!opts.showTooltip) return false
          const target = event.target as HTMLElement
          const annotationEl = target.closest('.ai-annotation')
          if (annotationEl) {
            const annotationId = annotationEl.getAttribute('data-annotation-id')
            if (annotationId) {
              const annotation = aiAnnotationsPluginKey.getState(view.state)?.records.find((a) => a.id === annotationId)
              if (annotation) showTooltip(annotation, event)
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

        click(view, event) {
          const target = event.target as HTMLElement
          const annotationEl = target.closest('.ai-annotation')
          if (annotationEl) {
            const annotationId = annotationEl.getAttribute('data-annotation-id')
            if (annotationId) {
              const annotation = aiAnnotationsPluginKey.getState(view.state)?.records.find((a) => a.id === annotationId)
              if (annotation && opts.onAnnotationClick) opts.onAnnotationClick(annotation)
            }
          }
          return false
        }
      }
    },

    view() {
      return {
        destroy() {
          removeTooltip()
        }
      }
    }
  })
}
