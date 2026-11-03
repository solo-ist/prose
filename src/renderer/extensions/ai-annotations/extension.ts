/**
 * AI Annotations TipTap Extension
 *
 * Wraps the ProseMirror plugin for time-fading gradient visuals on
 * AI-generated text, and exposes the record set's writes as commands. Each
 * command is a one-liner over the transaction helpers in `transactions.ts`,
 * which code that builds its own transaction (the suggestion accept paths)
 * calls directly.
 */

import { Extension } from '@tiptap/core'
import type { AIAnnotationOptions } from '../../types/annotations'
import { createAIAnnotationsPlugin } from './plugin'
import {
  addAnnotationsTo,
  removeAnnotationFrom,
  removeAnnotationsInRangeFrom,
  type AnnotationInput
} from './transactions'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiAnnotations: {
      /** Record AI-authored ranges; positions are in the document after this transaction's steps. */
      addAIAnnotations: (inputs: readonly AnnotationInput[]) => ReturnType
      /** Drop a record from the document's history (the Activity panel's X). */
      removeAIAnnotation: (id: string) => ReturnType
      /** Un-mark a range as AI-authored; records straddling an edge keep their outside parts. */
      removeAIAnnotationsInRange: (from: number, to: number) => ReturnType
    }
  }
}

export const AIAnnotations = Extension.create<AIAnnotationOptions>({
  name: 'aiAnnotations',

  addOptions() {
    return {
      className: 'ai-annotation',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      showTooltip: true,
      onAnnotationClick: undefined
    }
  },

  addCommands() {
    return {
      addAIAnnotations:
        (inputs) =>
        ({ tr }) => {
          addAnnotationsTo(tr, inputs)
          return true
        },
      removeAIAnnotation:
        (id) =>
        ({ tr }) => {
          removeAnnotationFrom(tr, id)
          return true
        },
      removeAIAnnotationsInRange:
        (from, to) =>
        ({ tr }) => {
          removeAnnotationsInRangeFrom(tr, from, to)
          return true
        }
    }
  },

  addProseMirrorPlugins() {
    return [createAIAnnotationsPlugin(this.options)]
  }
})
