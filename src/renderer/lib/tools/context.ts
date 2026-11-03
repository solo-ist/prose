/**
 * What a tool executor receives besides its arguments (#1148): the handle
 * of the document the call acts on (resolved once by `executeTool`, from a
 * chat turn's binding or the active tab), the provenance of the call, and
 * the binding itself for the tools that move a turn to another document.
 */

import type { DocumentHandle, ToolBinding } from '../../document/handle'
import type { ToolProvenance } from './provenanceTypes'

export interface ToolContext {
  /** Null only for tools that act on no document (files, tabs, UI). */
  handle: DocumentHandle | null
  provenance?: ToolProvenance
  binding?: ToolBinding
}
