/**
 * AI Annotations Store
 *
 * Zustand store for managing AI annotation state with persistence to IndexedDB.
 */

import { create } from 'zustand'
import type { AIAnnotation, AnnotationState, AnnotationActions } from '../../types/annotations'
import { generateId, saveAnnotations, loadAnnotations } from '../../lib/persistence'
import { pipelineLog } from '../../lib/aiPipelineLog'

type AnnotationStore = AnnotationState & AnnotationActions & {
  // Session-scoped set of annotation IDs created (not loaded) this session
  // These should not animate on appear
  createdThisSession: Set<string>
}

/**
 * Run saveAnnotations and record the in-flight write in `pendingSave` so
 * tab-switch code (saveCurrentTabState / select_tab) can await it before
 * loading the next document (#674). Every mutator that persists must route
 * through this — leaving any path on a bare fire-and-forget save reopens the
 * "annotation lost to a tab-switch race" gap. Clears pendingSave only if it
 * still points at this write (a newer save supersedes it).
 */
function trackedSave(
  get: () => AnnotationStore,
  set: (partial: Partial<AnnotationStore>) => void
): void {
  const savePromise = get().saveAnnotations()
  set({ pendingSave: savePromise })
  savePromise.finally(() => {
    if (get().pendingSave === savePromise) set({ pendingSave: null })
  })
}

export const useAnnotationStore = create<AnnotationStore>((set, get) => ({
  // Initial state
  annotations: [],
  isVisible: true,
  documentId: null,
  isLoadingDocument: false,
  pendingSave: null,
  createdThisSession: new Set(),

  // Add a new annotation
  addAnnotation: (annotationData) => {
    const id = generateId()
    const annotation: AIAnnotation = {
      ...annotationData,
      id,
      createdAt: Date.now(),
    }

    // Ensure store's documentId matches the annotation's documentId for correct persistence
    const currentDocId = get().documentId
    pipelineLog('annotation:create', {
      id,
      from: annotationData.from,
      to: annotationData.to,
      type: annotationData.type,
      content: annotationData.content?.substring(0, 30),
      annotationDocId: annotationData.documentId,
      storeDocId: currentDocId,
    })
    console.log('[AnnotationStore] addAnnotation:', {
      id,
      from: annotationData.from,
      to: annotationData.to,
      type: annotationData.type,
      content: annotationData.content?.substring(0, 30),
      annotationDocId: annotationData.documentId,
      storeDocId: currentDocId,
      willSync: annotationData.documentId && annotationData.documentId !== currentDocId
    })

    // Temporarily pause position updates while adding annotation
    // This prevents the plugin from immediately mapping (and corrupting) the new annotation's
    // positions, which are already in the correct coordinate system for the current document
    set({ isLoadingDocument: true })

    if (annotationData.documentId && annotationData.documentId !== currentDocId) {
      set((state) => ({
        annotations: [...state.annotations, annotation],
        documentId: annotationData.documentId,
      }))
    } else {
      set((state) => ({
        annotations: [...state.annotations, annotation],
      }))
    }

    // Auto-save after adding. Tracked so tab switches await it — a
    // fire-and-forget save racing loadAnnotations(nextDoc) was one of the
    // "history entries vanished" paths (#674).
    trackedSave(get, set)

    // Track that this annotation was created this session (should not animate)
    get().createdThisSession.add(id)

    // Resume position updates after microtask to let current transaction complete
    queueMicrotask(() => {
      set({ isLoadingDocument: false })
      console.log('[AnnotationStore] addAnnotation complete, position updates resumed')
    })

    return id
  },

  // Remove an annotation
  removeAnnotation: (id) => {
    set((state) => ({
      annotations: state.annotations.filter((a) => a.id !== id),
    }))

    trackedSave(get, set)
  },

  // Remove annotations in a range, splitting partially-overlapping ones into remnants
  removeAnnotationsInRange: (from, to) => {
    set((state) => {
      const updated: AIAnnotation[] = []

      for (const a of state.annotations) {
        if (a.to <= from || a.from >= to) {
          // No overlap — keep as-is
          updated.push(a)
        } else {
          // Overlaps — split into before/after remnants
          if (a.from < from) {
            updated.push({
              ...a,
              id: generateId(),
              to: from,
              content: a.content.slice(0, from - a.from),
            })
          }
          if (a.to > to) {
            updated.push({
              ...a,
              id: generateId(),
              from: to,
              content: a.content.slice(to - a.from),
            })
          }
          // If fully contained (a.from >= from && a.to <= to), no remnants → removed
        }
      }

      return { annotations: updated }
    })

    trackedSave(get, set)
  },

  // Update positions after document edits using ProseMirror position mapping
  updatePositions: (mapping) => {
    // Skip position updates during document loading (tab switches)
    if (get().isLoadingDocument) {
      console.log('[AnnotationStore] updatePositions SKIPPED - document is loading')
      return
    }

    let detachedThisPass = 0
    set((state) => {
      const updatedAnnotations: AIAnnotation[] = []

      for (const annotation of state.annotations) {
        // Detached annotations are history-only — their positions are stale
        // by definition, so they pass through untouched (#674).
        if (annotation.detached) {
          updatedAnnotations.push(annotation)
          continue
        }
        const mapped = mapping(annotation.from, annotation.to)

        if (mapped) {
          // Position still valid, update it
          if (mapped.from !== annotation.from || mapped.to !== annotation.to) {
            console.log('[AnnotationStore] updatePositions mapping:', {
              id: annotation.id,
              oldFrom: annotation.from,
              oldTo: annotation.to,
              newFrom: mapped.from,
              newTo: mapped.to
            })
          }
          updatedAnnotations.push({
            ...annotation,
            from: mapped.from,
            to: mapped.to,
          })
        } else {
          // Range collapsed (the annotated text was replaced/deleted by a
          // later edit). Detach instead of deleting (#674): the entry stays
          // in the history panel and IndexedDB — history is an immutable
          // per-document log — but renders no decoration.
          pipelineLog('annotation:detach', {
            id: annotation.id,
            from: annotation.from,
            to: annotation.to,
            reason: 'mapping-collapse',
          })
          console.log('[AnnotationStore] updatePositions - annotation detached by mapping:', {
            id: annotation.id,
            from: annotation.from,
            to: annotation.to
          })
          detachedThisPass++
          updatedAnnotations.push({ ...annotation, detached: true })
        }
      }

      return { annotations: updatedAnnotations }
    })
    // Persist only when a detach happened — this path runs on every
    // docChanged transaction (including typing), so unconditional saves
    // would hammer IndexedDB. Tracked so a tab switch racing this save
    // awaits it (same invariant as addAnnotation).
    if (detachedThisPass > 0) {
      trackedSave(get, set)
    }
  },

  // Update positions with proper handling of insertions inside annotations
  // Insertions inside annotations cause them to split, preserving only the AI-authored parts
  updatePositionsWithSplitting: (
    mapPos: (pos: number, bias: number) => number,
    insertions: Array<{ pos: number; length: number }>
  ) => {
    // Skip position updates during document loading (tab switches)
    if (get().isLoadingDocument) {
      console.log('[AnnotationStore] updatePositionsWithSplitting SKIPPED - document is loading')
      return
    }

    console.log('[AnnotationStore] updatePositionsWithSplitting called:', {
      insertions,
      annotationCount: get().annotations.length
    })
    let detachedThisPass = 0
    set((state) => {
      const updatedAnnotations: AIAnnotation[] = []

      for (const annotation of state.annotations) {
        // Detached annotations are history-only — pass through untouched (#674).
        if (annotation.detached) {
          updatedAnnotations.push(annotation)
          continue
        }
        // Check if any insertion was strictly inside this annotation
        const insertionInside = insertions.find(
          (ins) => ins.pos > annotation.from && ins.pos < annotation.to
        )

        if (insertionInside) {
          console.log('[AnnotationStore] Splitting annotation due to insertion:', {
            annotationId: annotation.id,
            annotationRange: [annotation.from, annotation.to],
            insertionPos: insertionInside.pos,
            insertionLength: insertionInside.length
          })
          // Split the annotation around the insertion point
          // Before part: [from, insertionPos) - mapped
          const beforeFrom = mapPos(annotation.from, 1)
          const beforeTo = mapPos(insertionInside.pos, -1)

          if (beforeFrom < beforeTo) {
            updatedAnnotations.push({
              ...annotation,
              id: generateId(),
              from: beforeFrom,
              to: beforeTo,
              content: annotation.content.slice(0, insertionInside.pos - annotation.from),
            })
          }

          // After part: (insertionPos + length, to] - mapped
          const afterFrom = mapPos(insertionInside.pos, 1) // After the insertion
          const afterTo = mapPos(annotation.to, -1)

          if (afterFrom < afterTo) {
            updatedAnnotations.push({
              ...annotation,
              id: generateId(),
              from: afterFrom,
              to: afterTo,
              content: annotation.content.slice(insertionInside.pos - annotation.from),
            })
          }

          // Both remnants collapsed — keep ONE detached entry carrying the
          // original annotation so the history record survives (#674).
          if (beforeFrom >= beforeTo && afterFrom >= afterTo) {
            pipelineLog('annotation:detach', {
              id: annotation.id,
              from: annotation.from,
              to: annotation.to,
              reason: 'split-collapse',
            })
            detachedThisPass++
            updatedAnnotations.push({ ...annotation, detached: true })
          }
        } else {
          // No insertion inside, just map positions normally
          const mappedFrom = mapPos(annotation.from, 1)
          const mappedTo = mapPos(annotation.to, -1)

          if (mappedFrom < mappedTo) {
            updatedAnnotations.push({
              ...annotation,
              from: mappedFrom,
              to: mappedTo,
            })
          } else {
            // Range collapsed — detach, don't delete (#674).
            pipelineLog('annotation:detach', {
              id: annotation.id,
              from: annotation.from,
              to: annotation.to,
              reason: 'mapping-collapse',
            })
            detachedThisPass++
            updatedAnnotations.push({ ...annotation, detached: true })
          }
        }
      }

      return { annotations: updatedAnnotations }
    })
    // Tracked save — see updatePositions for rationale.
    if (detachedThisPass > 0) {
      trackedSave(get, set)
    }
  },

  // Toggle visibility
  toggleVisibility: () => {
    set((state) => ({ isVisible: !state.isVisible }))
  },

  // Set visibility
  setVisibility: (visible) => {
    set({ isVisible: visible })
  },

  // Load annotations for a document
  loadAnnotations: async (documentId) => {
    console.log('[AnnotationStore] loadAnnotations called:', { documentId })
    try {
      const annotations = await loadAnnotations(documentId)
      pipelineLog('annotation:load', {
        documentId,
        count: annotations.length,
        replacedCount: get().annotations.length,
        previousDocId: get().documentId,
      })
      console.log('[AnnotationStore] Loaded from IndexedDB:', {
        documentId,
        count: annotations.length,
        annotations: annotations.map(a => ({
          id: a.id,
          from: a.from,
          to: a.to,
          type: a.type,
          content: a.content?.substring(0, 30)
        }))
      })
      // Clear the "created this session" set - loaded annotations should animate
      set({ annotations, documentId, createdThisSession: new Set() })
    } catch (error) {
      console.error('Failed to load annotations:', error)
      set({ annotations: [], documentId })
    }
  },

  // Save current annotations
  saveAnnotations: async () => {
    const { documentId, annotations } = get()
    console.log('[AnnotationStore] saveAnnotations called:', { documentId, count: annotations.length })
    if (!documentId) {
      console.warn('[AnnotationStore] Cannot save - no documentId')
      return
    }

    try {
      await saveAnnotations(documentId, annotations)
      pipelineLog('annotation:save', { documentId, count: annotations.length })
      console.log('[AnnotationStore] Saved successfully:', { documentId, count: annotations.length })
    } catch (error) {
      console.error('Failed to save annotations:', error)
    }
  },

  // Clear all annotations
  clearAnnotations: () => {
    set({ annotations: [] })
  },

  // Set document ID
  setDocumentId: (documentId) => {
    set({ documentId })
  },

  // Set loading document state (pauses position updates during tab switches)
  setLoadingDocument: (loading) => {
    console.log('[AnnotationStore] setLoadingDocument:', loading)
    set({ isLoadingDocument: loading })
  },
}))

// Selector for annotations at a specific position
export function getAnnotationsAtPosition(
  annotations: AIAnnotation[],
  pos: number
): AIAnnotation[] {
  return annotations.filter((a) => pos >= a.from && pos <= a.to)
}

// Selector for annotations overlapping a range
export function getAnnotationsInRange(
  annotations: AIAnnotation[],
  from: number,
  to: number
): AIAnnotation[] {
  return annotations.filter((a) => a.from < to && a.to > from)
}
