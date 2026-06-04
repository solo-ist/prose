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
  'bulletList',
  'orderedList',
  'taskList',
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

          // Pre-collect every id currently in the document so a regenerated
          // id can't collide with a real, not-yet-visited node's id (a fresh
          // id checked only against already-seen nodes could otherwise match
          // an unvisited unique id and wrongly displace it).
          const existingIds = new Set<string>()
          newState.doc.descendants((node) => {
            const id = node.attrs.nodeId
            if (typeof id === 'string' && id) existingIds.add(id)
          })

          // Track every id we've kept or assigned this pass, so we can both
          // generate collision-free new ids AND detect duplicates. Duplicates
          // arise when ProseMirror copies the `nodeId` attribute across a node
          // split (Enter mid-paragraph, or an insert that produces a sibling) —
          // both halves carry the same id, and without dedup they persist
          // forever, breaking id-based targeting (#681).
          const seen = new Set<string>()
          const freshId = (): string => {
            let id = generateNodeId()
            while (existingIds.has(id) || seen.has(id)) id = generateNodeId()
            return id
          }

          newState.doc.descendants((node, pos) => {
            // Only process nodes that should have IDs
            if (!NODE_TYPES_WITH_IDS.includes(node.type.name)) return

            // Check the transaction's current mapped document for an existing ID.
            // We intentionally do NOT use `node.attrs.nodeId` here: when tiptap-markdown
            // parses a list, sibling listItems may share the same attrs object reference.
            // After `setNodeMarkup` assigns an id to the first sibling, that shared attrs
            // object reflects the new id — so `node.attrs.nodeId` on subsequent siblings
            // would appear truthy even though no id was written for them, causing all
            // siblings to report the same id. Reading from `tr.doc` gives us the actual
            // committed state for each node individually.
            const currentNode = tr.doc.nodeAt(pos)
            const existingId = currentNode?.attrs.nodeId as string | null | undefined

            // Keep the first occurrence of a real, not-yet-seen id.
            if (existingId && !seen.has(existingId)) {
              seen.add(existingId)
              return
            }

            // Either no id, or a duplicate of one already seen this pass →
            // assign a fresh collision-free id (first occurrence above keeps
            // the original, so annotations/suggestions on it still resolve).
            const newId = freshId()
            seen.add(newId)
            tr.setNodeMarkup(pos, undefined, {
              ...(currentNode ?? node).attrs,
              nodeId: newId,
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

/** Container node types whose children should be nested, not emitted flat. */
const CONTAINER_TYPES = new Set([
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
])

/**
 * A node entry returned by getNodesWithIds.
 * Container nodes (blockquote, lists, listItems) include a `children` array;
 * leaf nodes omit it.
 */
export interface NodeWithId {
  nodeId: string
  type: string
  pos: number
  textContent: string
  children?: NodeWithId[]
}

/**
 * Recursively collect nodes with IDs from a ProseMirror node tree.
 * Container nodes appear with a `children` array; their descendants are NOT
 * emitted as top-level peers (avoids duplicated content for read_document consumers).
 */
function collectNodes(
  node: import('@tiptap/pm/model').Node,
  pos: number,
  doc: import('@tiptap/pm/model').Node
): NodeWithId[] {
  const result: NodeWithId[] = []

  node.forEach((child, offset) => {
    const childPos = pos + offset + 1 // +1 for the parent's opening token

    if (CONTAINER_TYPES.has(child.type.name)) {
      // Emit the container with its children nested
      const children = collectNodes(child, childPos, doc)
      const entry: NodeWithId = {
        nodeId: child.attrs.nodeId || '',
        type: child.type.name,
        pos: childPos,
        textContent: child.textContent,
        children,
      }
      // Only include the container if it has a nodeId (or has children worth surfacing)
      if (entry.nodeId || children.length > 0) {
        result.push(entry)
      }
    } else if (child.attrs.nodeId) {
      // Skip paragraphs inside list items — the listItem already covers the content
      if (child.type.name === 'paragraph') {
        const parent = doc.resolve(childPos).parent
        if (parent.type.name === 'listItem' || parent.type.name === 'taskItem') {
          return
        }
      }
      result.push({
        nodeId: child.attrs.nodeId,
        type: child.type.name,
        pos: childPos,
        textContent: child.textContent,
      })
    } else {
      // No nodeId on this child — recurse in case it has id-bearing children
      const deeper = collectNodes(child, childPos, doc)
      result.push(...deeper)
    }
  })

  return result
}

/**
 * Get all nodes with IDs as a nested tree.
 * Container nodes (blockquote, lists, listItems) carry a `children` array.
 * Descendants of containers are NOT emitted as top-level peers.
 * Useful for read_document output.
 */
export function getNodesWithIds(
  doc: import('@tiptap/pm/model').Node
): NodeWithId[] {
  // pos = -1 so the first top-level child's childPos = -1 + 0 + 1 = 0, matching
  // ProseMirror's content-position semantics for the doc root (which, unlike
  // inner container nodes, has no opening token to skip). Without this,
  // doc.resolve(childPos) lands one position too deep inside top-level paragraphs
  // and the listItem-skip filter below never fires — re-introducing the
  // duplication this walker was rewritten to eliminate. See #458, #489.
  return collectNodes(doc, -1, doc)
}

/**
 * Flatten a NodeWithId tree into a flat array.
 * Useful for error messages and utilities that need all nodes regardless of nesting.
 */
export function flattenNodes(nodes: NodeWithId[]): NodeWithId[] {
  const result: NodeWithId[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.children && node.children.length > 0) {
      result.push(...flattenNodes(node.children))
    }
  }
  return result
}
