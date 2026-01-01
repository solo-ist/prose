/**
 * AI Annotations TipTap Extension
 *
 * Wraps the ProseMirror plugin for time-fading gradient visuals
 * on AI-generated text.
 */

import { Extension } from '@tiptap/core'
import type { AIAnnotationOptions } from '../../types/annotations'
import { createAIAnnotationsPlugin } from './plugin'

export const AIAnnotations = Extension.create<AIAnnotationOptions>({
  name: 'aiAnnotations',

  addOptions() {
    return {
      className: 'ai-annotation',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      showTooltip: true,
      onAnnotationClick: undefined,
    }
  },

  addProseMirrorPlugins() {
    return [createAIAnnotationsPlugin(this.options)]
  },
})
