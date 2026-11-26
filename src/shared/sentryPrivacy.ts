/**
 * What a crash report may carry beyond the error itself: nothing.
 *
 * The Sentry SDK (JavaScript 11, @sentry/electron 8) collects every category
 * below unless told not to: the writer's IP address, cookies, request headers
 * and bodies, AI and MCP inputs and outputs. In Prose those bodies and inputs
 * are the writer's documents and prompts, and `docs/privacy.md` says a report
 * never includes document content or personal information. So both processes
 * pass this to `init`, and a category the SDK adds later fails
 * `sentryPrivacy.test.ts` until it is listed here.
 *
 * `frameContextLines` is left at its default: it is lines of Prose's own
 * source around a stack frame.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [] as never[],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false
}
