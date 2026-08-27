import type { CommandProps } from '@tiptap/core'
import { AISuggestion as BaseAISuggestion } from './extension'
import type { AISuggestionData } from './types'
import type { ReviewActor } from '../review-events'
import { createHumanSuggestionPlugin } from './humanSuggestionCapture'
import {
  collectSuggestionIds,
  findHumanInlineSuggestion,
  resolveHumanInlineSuggestion,
  restoreHumanInlineSuggestions,
  reviseHumanInlineInsertion,
  type InlineInsertionRevisionAttrs,
} from './humanSuggestionCommands'

interface ParentSuggestionCommands {
  acceptAISuggestion: (id: string, actor?: ReviewActor) => (props: CommandProps) => boolean
  rejectAISuggestion: (id: string, actor?: ReviewActor) => (props: CommandProps) => boolean
  acceptAllAISuggestions: (actor?: ReviewActor) => (props: CommandProps) => boolean
  rejectAllAISuggestions: (actor?: ReviewActor) => (props: CommandProps) => boolean
  restoreAISuggestions: (suggestions: AISuggestionData[]) => (props: CommandProps) => boolean
  reviseAISuggestion: (id: string, attrs: InlineInsertionRevisionAttrs) => (props: CommandProps) => boolean
}

export const AISuggestion = BaseAISuggestion.extend({
  addAttributes() {
    const parentAttributes = this.parent?.() ?? {}
    return {
      ...parentAttributes,
      humanInline: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-human-inline') === 'true',
        renderHTML: (attributes) => attributes.humanInline
          ? { 'data-human-inline': 'true' }
          : {},
      },
    }
  },

  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? []
    return [
      ...parentPlugins,
      createHumanSuggestionPlugin(),
    ]
  },

  addCommands() {
    const parent = (this.parent?.() ?? {}) as ParentSuggestionCommands

    return {
      ...parent,

      acceptAISuggestion:
        (id: string, actor: ReviewActor = { kind: 'user', source: 'ui' }) =>
        (props: CommandProps) => {
          const target = findHumanInlineSuggestion(props.state.doc, id)
          if (!target) {
            return parent.acceptAISuggestion(id, actor)(props)
          }
          return resolveHumanInlineSuggestion(
            props,
            target,
            'accept',
            actor,
            this.options.onSuggestionAccepted,
            this.options.onSuggestionRejected,
          )
        },

      rejectAISuggestion:
        (id: string, actor: ReviewActor = { kind: 'user', source: 'ui' }) =>
        (props: CommandProps) => {
          const target = findHumanInlineSuggestion(props.state.doc, id)
          if (!target) {
            return parent.rejectAISuggestion(id, actor)(props)
          }
          return resolveHumanInlineSuggestion(
            props,
            target,
            'reject',
            actor,
            this.options.onSuggestionAccepted,
            this.options.onSuggestionRejected,
          )
        },

      acceptAllAISuggestions:
        (actor: ReviewActor = { kind: 'user', source: 'ui' }) =>
        ({ editor, state, dispatch }: CommandProps) => {
          const ids = collectSuggestionIds(state.doc)
          if (!dispatch) return ids.length > 0
          let changed = false
          for (const id of ids) {
            changed = editor.commands.acceptAISuggestion(id, actor) || changed
          }
          return changed
        },

      rejectAllAISuggestions:
        (actor: ReviewActor = { kind: 'user', source: 'ui' }) =>
        ({ editor, state, dispatch }: CommandProps) => {
          const ids = collectSuggestionIds(state.doc)
          if (!dispatch) return ids.length > 0
          let changed = false
          for (const id of ids) {
            changed = editor.commands.rejectAISuggestion(id, actor) || changed
          }
          return changed
        },

      reviseAISuggestion:
        (id: string, attrs: InlineInsertionRevisionAttrs) =>
        (props: CommandProps) => {
          const target = findHumanInlineSuggestion(props.state.doc, id)
          if (!target) return parent.reviseAISuggestion(id, attrs)(props)
          return reviseHumanInlineInsertion(
            props,
            target,
            attrs,
            this.options.onSuggestionAdded,
          )
        },

      restoreAISuggestions:
        (suggestions: AISuggestionData[]) =>
        (props: CommandProps) => {
          if (!props.dispatch || suggestions.length === 0) return false
          const human = suggestions.filter((suggestion) => suggestion.humanInline === true)
          const other = suggestions.filter((suggestion) => suggestion.humanInline !== true)
          const restoredHuman = restoreHumanInlineSuggestions(props.tr, props.state, human)

          if (other.length > 0 && parent.restoreAISuggestions(other)(props)) {
            return true
          }
          if (restoredHuman > 0) {
            props.dispatch(props.tr)
            return true
          }
          return false
        },
    }
  },
})
