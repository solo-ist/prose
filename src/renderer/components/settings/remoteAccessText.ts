/**
 * Wording for a trusted remote client that connected without approval
 * (#1304): the toast and the Connections row. Pure, so it is tested.
 */
import type { RemoteChange } from '../../../shared/mcp/remoteAccess'
import type { RemoteScope } from '../../../shared/mcp/remoteScopes'

const SCOPE_VERBS: Record<RemoteScope, string> = {
  read: 'read',
  propose: 'suggest edits on',
  comment: 'comment on'
}

/** "read", "read and comment on", "read, suggest edits on and comment on" (read always first). */
export function remoteScopeSummary(scopes: readonly RemoteScope[]): string {
  const verbs = (['read', 'propose', 'comment'] as const)
    .filter((s) => s === 'read' || scopes.includes(s))
    .map((s) => SCOPE_VERBS[s])
  if (verbs.length === 1) return verbs[0]
  return `${verbs.slice(0, -1).join(', ')} and ${verbs[verbs.length - 1]}`
}

/** The toast for a trusted client's first connection: its name, its proven domain, what it can do. */
export function remoteConnectedMessage(change: Extract<RemoteChange, { reason: 'connected' }>): string {
  const name = change.clientName.slice(0, 80)
  const who = change.host ? `${name} (${change.host})` : name
  return `${who} is now connected to Prose. It can ${remoteScopeSummary(change.scopes)} the documents you have open.`
}
