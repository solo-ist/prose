/**
 * AI Annotation Types
 *
 * Defines the data structures for tracking AI-generated text provenance
 * with time-fading gradient visuals.
 */

/**
 * Type of AI text modification
 */
export type AnnotationType = 'insertion' | 'replacement'

/**
 * Provenance information about the AI that generated the text
 */
export interface AIProvenance {
  /** The AI model that generated the text (e.g., "claude-3-opus") */
  model: string
  /** The conversation ID where the edit originated */
  conversationId: string
  /** The specific message ID that contained the edit */
  messageId: string
}

/**
 * A single AI annotation tracking a piece of AI-generated text
 */
export interface AIAnnotation {
  /** Unique identifier for this annotation */
  id: string
  /** The document this annotation belongs to */
  documentId: string
  /** Type of modification: insertion (new text) or replacement (modified existing) */
  type: AnnotationType
  /** When the annotation was created (timestamp in ms) */
  createdAt: number
  /** Start position in the document (updated via position mapping) */
  from: number
  /** End position in the document (updated via position mapping) */
  to: number
  /** The text content that was inserted/replaced */
  content: string
  /** Provenance information about the AI source */
  provenance: AIProvenance
}

/**
 * Configuration for the AI Annotations extension
 */
export interface AIAnnotationOptions {
  /** CSS class for the annotation wrapper */
  className?: string
  /** Maximum age in milliseconds before annotation fully fades (default: 7 days) */
  maxAge?: number
  /** Whether to show provenance tooltip on hover */
  showTooltip?: boolean
  /** Callback when an annotation is clicked */
  onAnnotationClick?: (annotation: AIAnnotation) => void
}

/**
 * State for the annotations store (Zustand)
 */
export interface AnnotationState {
  /** All annotations for the current document */
  annotations: AIAnnotation[]
  /** Whether annotations are currently visible */
  isVisible: boolean
  /** The current document ID */
  documentId: string | null
}

/**
 * Actions for the annotations store
 */
export interface AnnotationActions {
  /** Add a new annotation */
  addAnnotation: (annotation: Omit<AIAnnotation, 'id' | 'createdAt'>) => string
  /** Remove an annotation by ID */
  removeAnnotation: (id: string) => void
  /** Update annotation positions after document edits */
  updatePositions: (mapping: (from: number, to: number) => { from: number; to: number } | null) => void
  /** Toggle visibility of annotations */
  toggleVisibility: () => void
  /** Set visibility of annotations */
  setVisibility: (visible: boolean) => void
  /** Load annotations for a document */
  loadAnnotations: (documentId: string) => Promise<void>
  /** Save current annotations */
  saveAnnotations: () => Promise<void>
  /** Clear all annotations (for new document) */
  clearAnnotations: () => void
  /** Set document ID */
  setDocumentId: (documentId: string | null) => void
}

/**
 * Decoration metadata for rendering
 */
export interface AnnotationDecorationMeta {
  annotation: AIAnnotation
  /** Opacity based on age (1 = fresh, 0 = fully faded) */
  opacity: number
  /** Human-readable age string */
  ageString: string
}

/**
 * Constants for time-fading behavior
 */
export const ANNOTATION_CONSTANTS = {
  /** Maximum age before fully faded (7 days in ms) */
  MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
  /** Minimum opacity (never fully invisible for accessibility) */
  MIN_OPACITY: 0.05,
  /** How often to recalculate opacity (every 5 minutes) */
  REFRESH_INTERVAL_MS: 5 * 60 * 1000,
} as const

/**
 * Calculate opacity based on annotation age
 * @param createdAt - Timestamp when annotation was created
 * @param maxAge - Maximum age in ms (default: 7 days)
 * @returns Opacity value between MIN_OPACITY and 1
 */
export function calculateOpacity(createdAt: number, maxAge = ANNOTATION_CONSTANTS.MAX_AGE_MS): number {
  const age = Date.now() - createdAt
  if (age <= 0) return 1
  if (age >= maxAge) return ANNOTATION_CONSTANTS.MIN_OPACITY

  // Exponential decay for more natural fading
  // Fresh annotations (< 24h) stay more visible
  const ratio = age / maxAge
  const opacity = Math.pow(1 - ratio, 0.7) // 0.7 exponent for slower initial fade

  return Math.max(ANNOTATION_CONSTANTS.MIN_OPACITY, opacity)
}

/**
 * Format age as human-readable string
 */
export function formatAge(createdAt: number): string {
  const age = Date.now() - createdAt
  const seconds = Math.floor(age / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}
