# #1271: OpenAI chat is slow, because gpt-5 runs at medium reasoning on every tool step

Part of 1.9.1 (epic [#1230](https://github.com/solo-ist/prose/issues/1230)); found in the operator's live A2 test.
Queued after #1268: branch `issue-1271-openai-reasoning-effort`, cut from #1268's head and merged up to
`release/v1.9.1` once #1268 lands. It touches `src/main`, so it's gated, and the operator's go covers merging it into
the release branch.

## What the log and the code show

- **The turn shape:** each user turn runs 5–6 Chat Completions rounds, one per tool step, each carrying the whole
  tool list. In the stub flow that's 28 tools in Editor mode; the operator's log showed 31.
- **No `reasoning_effort`:** `PROVIDERS.openai.chatCompletions` is unset, so `gpt-5` runs at its default `medium` on
  every round. Chat Completions doesn't stream reasoning, so each round is dead air until its first token.
- **`max_completion_tokens`:** `useChat` sends `maxTokens: 16000` and the adapter passes it straight through as
  `max_completion_tokens`. Reasoning tokens count against that limit.
- **Measured with the stub** (`e2e/openai-stub.ts`, a 6-round turn of five `read_document` steps and a reply, real
  renderer and real main):

  | | Total | Per round | Efforts sent | `max_completion_tokens` |
  |---|---|---|---|---|
  | Before | 124 ms | 5–17 ms | none | 16000 |
  | After | 124 ms | 5–17 ms | `low` on all six | 24000 |

  So Prose's own overhead is negligible. The wait is the model's time to first token, paid once per round, and
  reasoning effort is the lever. The stub can't model that latency; the real-key comparison is the operator's QA line.

## Fix

- **Per-model effort.** `ProviderInfo.chatCompletions.reasoningEffortFor(model)` sets it per model, not per provider.
  For OpenAI it returns `'low'` for reasoning models (`isOpenAIReasoningModel`: the `gpt-5` family and the o-series,
  minus the `-chat` aliases) and nothing otherwise, since `gpt-4.1` rejects the parameter.
- **Co-op.** A3's co-op entry will answer `'none'` through the same function.
- **Headroom.** `reasoningHeadroom: 8000` is added to `max_completion_tokens` when a model reasons, so the
  writer-facing output keeps the same 16000 the Anthropic path gets. `'none'` adds no headroom.
- **One helper.** `chatCompletionsTuning(provider, model, maxTokens)` returns both values. `llm:stream` and `llm:chat`
  spread it into the request body.

## Tests

- **vitest** (`providers.test.ts`):
  - `gpt-5`, `gpt-5-mini` and `o4-mini` get `low` and 24000;
  - `gpt-4.1` and `gpt-5-chat-latest` get no effort and 16000;
  - the summary path gets no limit;
  - a `'none'` provider gets no headroom, and Anthropic gets nothing.
- **e2e** (`openai-provider.spec.ts`):
  - the tool-loop case asserts `reasoning_effort: 'low'` on both rounds and `max_completion_tokens: 24000`. It
    fails on a build of the base;
  - a new case selects `gpt-4.1` (remembered per provider) and asserts no `reasoning_effort` and 16000.
- **Typecheck:** 66 / 18 / 6.
