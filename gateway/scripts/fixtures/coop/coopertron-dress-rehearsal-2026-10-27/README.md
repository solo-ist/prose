# Coopertron dress rehearsal, 2026-10-27

Raw request/response pairs from a full `synthesize.py` run on the co-op
gateway: 50 synthetic member responses (CryptPad Form export), model
`tinfoil/glm-5.3`, `reasoning_effort: low`, `max_tokens: 8000`, no tools.

| Call | Wall | Prompt | Completion | Reasoning tokens | finish |
|---|---|---|---|---|---|
| tag1 (15 responses) | 18.7s | 3518 | 4799 | 5 | stop |
| tag2 | 17.1s | 2849 | 3407 | 559 | stop |
| tag3 | 15.4s | 2501 | 3185 | 0 | stop |
| tag4 (5 responses) | 5.0s | 1158 | 1150 | 0 | stop |
| cluster (220 items) | 22.6s | 4573 | 5253 | 2588 | stop |

Total 14,599 in / 17,794 out, gateway-reported cost ≈ $0.129 (dry-run
estimate was $0.183). All five calls returned valid JSON first try; 0 of 220
extracted quotes failed substring verification.

Relevant to Prose #952/#1074: with `reasoning_effort: low`, GLM-5.3's
reasoning spend varies call to call (0 to 2588 tokens) but never approached
the completion budget. `prompt_tokens_details.created_cache_tokens` was
populated on every call and `cached_tokens` hit 384 on tag2–tag4 (shared
system prompt prefix). No fallback to another provider was observed: every
response reported `model: tinfoil/glm-5.3`.

## Later runs the same day (prompt tuning)

Two more passes on the same export after adding `context`/`offer` kinds and a
firmer `novel` rule. Files are distinguishable by timestamp.

| Run | Calls | Reasoning tokens (cluster) | Novel returned | Cost |
|---|---|---|---|---|
| 1 (baseline) | 5 | 2588 | 10 | ≈$0.129 |
| 2 (new tag prompt) | 5 | 4525 | 2 | ≈$0.141 |
| 3 (new cluster prompt, tag cached) | 1 | 2640 | 9 | ≈$0.130 cumulative, ≈$0.05 marginal |

Observations: tag-stage reasoning tokens were 0 on all four calls in run 2
(vs 5/559/0/0 in run 1) at the same `reasoning_effort: low`; the cluster call's
reasoning spend swung 2.6k → 4.5k → 2.6k on near-identical input. All calls
`finish_reason: stop`, all `model: tinfoil/glm-5.3`, 0 quotes failed
verification in any run.
