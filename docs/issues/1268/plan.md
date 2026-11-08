# #1268: an out-of-credits key reads as "rate limited": classify LLM errors once

Part of 1.9.1 (epic [#1230](https://github.com/solo-ist/prose/issues/1230)); found in the operator's live A2 test.
Branch `issue-1268-llm-quota-errors` from `release/v1.9.1` = `6907393`. Touches `src/main` and `src/preload`, so it is
gated; the operator's go covers merging it into the release branch.

## Inventory

- **What arrived:** `ChatCompletionsError: HTTP 429: You have no credits remaining…`, which is OpenAI's
  `insufficient_quota` (status 429). `errorFromResponse` keeps only `HTTP <status>: <message>`.
- **`getNetworkErrorMessage`** (`src/shared/utils/retry.ts`) turns any message containing "429" into "Rate limited by
  the API. Please wait a moment and try again." It is used for every LLM error event in `ipc.ts`: `llm:chat`, both
  `llm:stream` paths and Chat Completions.
- **`isRetryableError`** retries every 429. Only `llm:chat` uses `withRetry`. The AI SDK's `streamText` also retries
  internally, but not on 400s.
- **`settings:testApiKey`** maps a 429 to "Rate limited - but API key is valid". For Chat Completions it only lists
  models, which works without credits, so it can never see a quota error.
- **`useChat`** guesses guidance from substrings in two places: "Wait a moment and try again" in the stream error
  handler, and "Please wait a moment" in the send catch.
- **Error shapes:**
  - OpenAI: `{ error: { message, type, code } }`, with `insufficient_quota`, `billing_hard_limit_reached`,
    `rate_limit_exceeded`, `invalid_api_key`.
  - LiteLLM: `{ error: { message, type: 'budget_exceeded', code: '400' } }`.
  - Anthropic SDK `APIError`: `.status` and `.error = { type: 'error', error: { type, message } }`. A 429 is
    `rate_limit_error`; billing is a 400 `invalid_request_error` saying "Your credit balance is too low…".
  - AI SDK `APICallError`: `.statusCode` and `.responseBody`, possibly wrapped in a `RetryError` (`.lastError`).

## Design

**`src/shared/llm/errors.ts`** (new) holds `classifyLlmError(error) → { kind, status?, code?, type?, providerMessage }`.
It unwraps `RetryError.lastError`, reads the status (`status`, `statusCode` or an `HTTP nnn` prefix), reads `code` and
`type` (its own fields, the Anthropic body, or a parsed `responseBody`), and keeps the provider's own message. The
first matching kind wins:

| Kind | Matches |
|---|---|
| `quota` | `insufficient_quota`, `billing_hard_limit_reached`, `budget_exceeded`, or text about credits, quota or billing |
| `auth` | 401/403, `invalid_api_key`, `authentication_error`, `permission_error` |
| `rate_limit` | `rate_limit_exceeded`, `rate_limit_error`, or any other 429 |
| `transient` | network codes, timeouts, 5xx/529, overloaded |
| `other` | anything else |

The same module adds:

- `isRetryableLlmError(info)`: true for `rate_limit` and `transient` only.
- `llmErrorMessage(info, provider?)`: one plain sentence naming the provider. Quota names the provider's billing page,
  a rate limit passes the provider's own wording through, and auth names the provider.
- `llmErrorGuidance(kind, message)`: the one-line hint `useChat` appends. It is empty for quota.

**Callers:**

- `retry.ts`: `isRetryableError` and `getNetworkErrorMessage` delegate to the classifier.
- `chatCompletions.ts`: `ChatCompletionsError` carries `status`, `code` and `type` from the body, including a
  mid-stream `error` object.
- `ipc.ts`:
  - every LLM error event and throw uses `llmErrorMessage(classifyLlmError(e), provider)`;
  - `llm:stream:error` carries `kind`;
  - `settings:testApiKey` classifies too. For Chat Completions it adds a tiny non-streamed completion probe
    (`max_completion_tokens: 16`) after `/models`, and only a quota answer from the probe changes the result.
- **The key test on quota:** answers `{ success: true, warning: true, message: 'Key is valid, but the OpenAI account
  has no credits…' }`. The key is valid and should save; the warning shows in amber in Settings and in onboarding.
- **Renderer:** `useChat` uses the event's `kind`, or classifies the message on the send-catch path.
- **Providers:** `providers.ts` gains a `billingHint` per provider.

## Tests

- **vitest `src/shared/llm/errors.test.ts`**, on real body samples, checking the kind, retryability and message of
  each:
  - OpenAI `insufficient_quota` (429) and `rate_limit_exceeded` (429);
  - LiteLLM `budget_exceeded` (400);
  - Anthropic `rate_limit_error` (429) and its 400 credit error, through the SDK `APIError` shape;
  - an AI SDK `RetryError` wrapping an `APICallError`;
  - 401, network, 5xx and other.
- **`chatCompletions.test.ts`**: `code` and `type` parsed from an error body, and from a stream `error` object.
- **e2e, in `openai-provider.spec.ts`:** the stub answers 429 `insufficient_quota`. The chat shows the credits
  message and no "wait a moment", and the stub sees exactly one streamed request. Falsified on `6907393`.
- **Baselines:** 66 / 18 / 6.
