/**
 * AI Annotations Extension
 *
 * Provides permanent AI text provenance tracking with time-fading gradient visuals.
 */

export { AIAnnotations } from './extension'
export { useAnnotationStore, getAnnotationsAtPosition, getAnnotationsInRange } from './store'
export { aiAnnotationsPluginKey } from './plugin'
export type { AIAnnotation, AIAnnotationOptions, AIProvenance, AnnotationType } from '../../types/annotations'
export { calculateOpacity, formatAge, ANNOTATION_CONSTANTS } from '../../types/annotations'
