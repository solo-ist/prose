# Co-op gateway captures: Coopertron smoke test, 2026-10-19

Raw request/response pairs from `solo.ist/coopertron` (Coopertron 5000) `synthesize.py` against
`https://gateway.inference.coop/v1/chat/completions` on `tinfoil/glm-5.3`,
on an individual member key (sent as a header; not in any file). Survey text
is synthetic.

What they show (relevant to Prose #952 / #1074):

- `*-tag1-cbd13bbb.json` and `*-tag1-retry-*.json`: GLM-5.3 with no reasoning
  controls on a ~1.6k-token extraction prompt and `max_tokens: 8000` returned
  `finish_reason: length`, `content: ""`, `reasoning_tokens: 8000`, with the
  reasoning in `message.reasoning_content`. Billed in full. Any client that
  relies on this model needs `reasoning_effort` or a very large budget.
- `*-tag1-93204924.json` and `*-cluster-*.json`: the same prompts with
  `reasoning_effort: "low"` returned clean fenced JSON in ~10s each
  (`reasoning_tokens` 0 and 450). The gateway forwards `reasoning_effort` and
  `chat_template_kwargs` unchanged to the provider.
- `usage.prompt_tokens_details` carries `cached_tokens` / `created_cache_tokens`
  (prompt caching is active at the provider). Prices in the co-op config list a
  cached-input rate for this model.
- Response envelopes are plain OpenAI chat-completions shape; no `impact` block
  appeared on these calls (it did on an earlier 1.5 MB prompt probe).

Separate small probes (not captured here) on 2026-10-19: `reasoning_effort:
none` and `chat_template_kwargs.enable_thinking=false` both set
`reasoning_tokens` to 0 on GLM-5.3 but leaked the thinking into `content`;
`tinfoil/deepseek-v4-1-flash` with `enable_thinking=false` returned clean JSON
with no reasoning; `tinfoil/gpt-oss-120b` reports no `reasoning_tokens` field.
