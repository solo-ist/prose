/**
 * The tracked-change marks (#891; design: docs/architecture/suggesting-mode.md
 * §2). Text the writer or an agent proposes to add carries `trackedInsert`;
 * text proposed for removal stays in the document and carries
 * `trackedDelete`. Both hold who made the change and when, and an id shared
 * by every range of one change (a replacement is a delete and an insert under
 * one id).
 *
 * Neither mark reaches a file: the session's projection serializes
 * `originalOf(doc)` (insertions removed, deletion marks dropped), and the
 * marks' own markdown spec writes nothing, so a stray raw serialization can't
 * write HTML for them either. The actor is state only, like the suggestion
 * mark's: never rendered to the DOM (it would ride the clipboard) and never
 * parsed from HTML (pasted markup can't claim one). No parse rule at all: a
 * paste of tracked text comes in as plain text.
 */

import { Mark, mergeAttributes } from '@tiptap/core'
import type { Actor } from '../../../shared/review/actor'

export const TRACKED_INSERT = 'trackedInsert'
export const TRACKED_DELETE = 'trackedDelete'

export interface TrackedMarkAttrs {
  id: string
  actor: Actor | null
  createdAt: number
}

const silent = { open: '', close: '', mixable: true, expelEnclosingWhitespace: true }

/** A stable colour slot per actor, for the underline (§6): the writer is 0, agents 1–5. */
export function actorSlot(actor: Actor | null | undefined): number {
  if (!actor || actor.kind === 'human') return 0
  const key =
    actor.kind === 'mcp-agent' ? `mcp:${actor.connectionId}` : actor.kind === 'prose-agent' ? `prose:${actor.model}` : `u:${actor.label}`
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return 1 + (hash % 5)
}

function trackedAttributes() {
  return {
    id: {
      default: null,
      parseHTML: () => null,
      renderHTML: (attributes: Record<string, unknown>) => (attributes.id ? { 'data-tracked-id': String(attributes.id) } : {}),
    },
    actor: {
      default: null,
      parseHTML: () => null,
      renderHTML: () => ({}),
    },
    createdAt: {
      default: 0,
      parseHTML: () => 0,
      renderHTML: () => ({}),
    },
  }
}

function markSpec(name: string, tag: 'ins' | 'del', className: string) {
  return Mark.create({
    name,
    // Typing at the edge of a change is not part of it: the filter marks the
    // writer's own text explicitly, and with Suggesting off a direct edit
    // next to a change stays direct.
    inclusive: false,
    excludes: `${TRACKED_INSERT} ${TRACKED_DELETE}`,
    addAttributes: trackedAttributes,
    addStorage() {
      return { markdown: { serialize: silent } }
    },
    parseHTML() {
      return []
    },
    renderHTML({ mark, HTMLAttributes }) {
      const actor = mark.attrs.actor as Actor | null
      return [
        tag,
        mergeAttributes(HTMLAttributes, {
          class: className,
          'data-tracked-by': actor?.kind === 'human' || !actor ? 'writer' : 'agent',
          'data-tracked-slot': String(actorSlot(actor)),
        }),
        0,
      ]
    },
  })
}

export const TrackedInsert = markSpec(TRACKED_INSERT, 'ins', 'tracked-insert')
export const TrackedDelete = markSpec(TRACKED_DELETE, 'del', 'tracked-delete')
