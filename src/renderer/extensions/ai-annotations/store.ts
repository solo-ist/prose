/**
 * AI Annotations Store
 *
 * Zustand store for managing AI annotation state with persistence to IndexedDB.
 */

import { create } from 'zustand'
import type { AIAnnotation, AnnotationState, AnnotationActions } from '../../types/annotations'
import { generateId, saveAnnotations, loadAnnotations } from '../../lib/persistence'

type AnnotationStore = AnnotationState & AnnotationActions

export const useAnnotationStore = create<AnnotationStore>((set, get) => ({
  // Initial state
  annotations: [],
  isVisible: true,
  documentId: null,

  // Add a new annotation
  addAnnotation: (annotationData) => {
    const id = generateId()
    const annotation: AIAnnotation = {
      ...annotationData,
      id,
      createdAt: Date.now(),
    }

    set((state) => ({
      annotations: [...state.annotations, annotation],
    }))

    // Auto-save after adding
    get().saveAnnotations()

    return id
  },

  // Remove an annotation
  removeAnnotation: (id) => {
    set((state) => ({
      annotations: state.annotations.filter((a) => a.id !== id),
    }))

    get().saveAnnotations()
  },

  // Update positions after document edits using ProseMirror position mapping
  updatePositions: (mapping) => {
    set((state) => {
      const updatedAnnotations: AIAnnotation[] = []

      for (const annotation of state.annotations) {
        const mapped = mapping(annotation.from, annotation.to)

        if (mapped) {
          // Position still valid, update it
          updatedAnnotations.push({
            ...annotation,
            from: mapped.from,
            to: mapped.to,
          })
        }
        // If mapping returns null, the annotation was deleted
      }

      return { annotations: updatedAnnotations }
    })
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
    try {
      const annotations = await loadAnnotations(documentId)
      set({ annotations, documentId })
    } catch (error) {
      console.error('Failed to load annotations:', error)
      set({ annotations: [], documentId })
    }
  },

  // Save current annotations
  saveAnnotations: async () => {
    const { documentId, annotations } = get()
    if (!documentId) return

    try {
      await saveAnnotations(documentId, annotations)
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
