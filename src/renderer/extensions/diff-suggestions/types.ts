/**
 * Diff Suggestions Extension for TipTap
 *
 * Originally from: https://github.com/bsachinthana/tiptap-diff-suggestions
 * Author: Buddhima Sachinthana (@buddhima_a)
 * License: MIT
 *
 * Vendored and modified for Prose by solo.ist
 */

import type { Command } from '@tiptap/core'

export interface DiffSuggestionMeta {
  id: string
  comment?: string
  accepted: boolean
  originalText: string
  suggestedText: string
  pos?: number
}

export interface DiffSuggestionActionMeta {
  id: string
  comment?: string
  originalText: string
  suggestedText: string
  pos: number
  accepted?: boolean
}

export interface DiffSuggestionTheme {
  variables?: {
    acceptBg?: string
    rejectBg?: string
    borderColor?: string
    acceptColor?: string
    rejectColor?: string
    hoverBg?: string
  }
}

export interface DiffSuggestionButtonConfig {
  content: string
  title?: string
  className?: string
  style?: Record<string, string>
}

export interface DiffSuggestionOptions {
  HTMLAttributes: Record<string, unknown>
  className?: string
  showButtons?: boolean
  buttons?: {
    accept?: string | DiffSuggestionButtonConfig
    reject?: string | DiffSuggestionButtonConfig
  }
  renderActionMenu?: (meta: DiffSuggestionActionMeta) => HTMLElement
  theme?: DiffSuggestionTheme
  onAccept?: (meta: DiffSuggestionMeta) => void
  onReject?: (meta: DiffSuggestionMeta) => void
  handleAccept?: Command
  handleReject?: Command
}

export interface DiffSuggestionAttributes {
  id: string
  comment?: string
  originalText: string
  suggestedText: string
}
