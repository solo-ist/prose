/**
 * relay/log.ts — the relay's metadata log (#1238, design §4 "Logs"): who,
 * which client, which method and tool, how long, how many bytes, and how it
 * ended. Never a call's params or result, a header value, or anything else a
 * client or a document supplied: those are data the relay carries, not data
 * it keeps. Client-supplied names are logged only when they match a known
 * shape, so a crafted method or tool name can't write into the log.
 */
const SAFE_ID = /^[A-Za-z0-9._:/?=&%~+-]{1,200}$/
const SAFE_METHOD = /^[a-z][A-Za-z0-9/_-]{0,63}$/

export function safeId(value: string | undefined | null): string {
  return value && SAFE_ID.test(value) ? value : '-'
}

export function safeMethod(value: string | undefined | null): string {
  return value && SAFE_METHOD.test(value) ? value : 'other'
}

export interface CallLogEntry {
  account: string
  client: string
  method: string
  tool?: string
  ms: number
  inBytes: number
  outBytes: number
  outcome: string
}

export function logCall(e: CallLogEntry): void {
  console.log(
    `[relay] call account=${safeId(e.account)} client=${safeId(e.client)} method=${safeMethod(e.method)} ` +
      `tool=${e.tool ? safeMethod(e.tool) : '-'} ms=${e.ms} in=${e.inBytes}B out=${e.outBytes}B outcome=${e.outcome}`
  )
}
