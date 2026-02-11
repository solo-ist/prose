/**
 * NodeIds extension - adds persistent IDs to block nodes for AI targeting.
 *
 * This extension adds a `nodeId` attribute to paragraphs, headings, and other
 * block-level nodes. IDs are generated automatically and persist through edits.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

// Short random ID generator (8 chars)
function generateNodeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

// Node types that should have IDs
const NODE_TYPES_WITH_IDS = [
  'paragraph',
  'heading',
  'codeBlock',
  'blockquote',
  'listItem',
  'taskItem',
]

export const NodeIds = Extension.create({
  name: 'nodeIds',

  addGlobalAttributes() {
    return [
      {
        types: NODE_TYPES_WITH_IDS,
        attributes: {
          nodeId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-node-id'),
            renderHTML: (attributes) => {
              if (!attributes.nodeId) return {}
              return { 'data-node-id': attributes.nodeId }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    let initialized = false

    return [
      new Plugin({
        key: new PluginKey('nodeIds'),
        appendTransaction: (transactions, oldState, newState) => {
          // Process if document changed OR this is the first run (to assign IDs to initial content)
          const docChanged = transactions.some((tr) => tr.docChanged)
          const isFirstRun = !initialized
          initialized = true

          if (!docChanged && !isFirstRun) return null

          let modified = false
          const tr = newState.tr

          newState.doc.descendants((node, pos) => {
            // Only process nodes that should have IDs
            if (!NODE_TYPES_WITH_IDS.includes(node.type.name)) return

            // Skip if node already has an ID
            if (node.attrs.nodeId) return

            // Assign a new ID
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              nodeId: generateNodeId(),
            })
            modified = true
          })

          return modified ? tr : null
        },
      }),
    ]
  },
})

/**
 * Find a node by its ID in the document.
 * Returns the node and its position, or null if not found.
 */
export function findNodeById(
  doc: import('@tiptap/pm/model').Node,
  nodeId: string
): { node: import('@tiptap/pm/model').Node; pos: number } | null {
  let result: { node: import('@tiptap/pm/model').Node; pos: number } | null = null

  doc.descendants((node, pos) => {
    if (result) return false // Stop traversal if found
    if (node.attrs.nodeId === nodeId) {
      result = { node, pos }
      return false
    }
  })

  return result
}

/**
 * Find a node by matching its text content.
 * Used as a fallback when node IDs are stale (e.g., after document re-parse).
 * Returns the first match.
 */
export function findNodeByContent(
  doc: import('@tiptap/pm/model').Node,
  text: string
): { node: import('@tiptap/pm/model').Node; pos: number } | null {
  let result: { node: import('@tiptap/pm/model').Node; pos: number } | null = null
  const normalized = text.trim()

  doc.descendants((node, pos) => {
    if (result) return false
    if (!NODE_TYPES_WITH_IDS.includes(node.type.name)) return
    if (node.textContent.trim() === normalized) {
      result = { node, pos }
      return false
    }
  })

  return result
}

/**
 * Get all nodes with IDs as a flat list.
 * Useful for read_document output.
 */
export function getNodesWithIds(
  doc: import('@tiptap/pm/model').Node
): Array<{ nodeId: string; type: string; pos: number; textContent: string }> {
  const nodes: Array<{ nodeId: string; type: string; pos: number; textContent: string }> = []

  doc.descendants((node, pos) => {
    if (node.attrs.nodeId) {
      nodes.push({
        nodeId: node.attrs.nodeId,
        type: node.type.name,
        pos,
        textContent: node.textContent,
      })
    }
  })

  return nodes
}
