/**
 * AI Annotations Extension
 *
 * Provides permanent AI text provenance tracking with time-fading gradient visuals.
 * The records live in the plugin state of each document (#1146): read them with
 * `annotationsOf(state)` / `selectAnnotations`, write them through the editor
 * commands or the transaction helpers.
 */

export { AIAnnotations } from './extension'
export {
  aiAnnotationsPluginKey,
  addAnnotationsTo,
  removeAnnotationFrom,
  removeAnnotationsInRangeFrom,
  loadAnnotationsInto,
  annotationsOf,
  annotationPluginState,
  selectAnnotations,
  EMPTY_ANNOTATIONS
} from './transactions'
export type { AnnotationInput, AnnotationMeta, AIAnnotationsPluginState } from './transactions'
export type { AIAnnotation, AIAnnotationOptions, AIProvenance, AnnotationType } from '../../types/annotations'
export { calculateOpacity, formatAge, ANNOTATION_CONSTANTS } from '../../types/annotations'
