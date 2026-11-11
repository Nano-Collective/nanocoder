---
"@nanocollective/nanocoder": patch
---

Claude models now use the same `o200k_base` token estimate as other models that have no published tokenizer. Before, they used the Claude 2-era `@anthropic-ai/tokenizer` vocabulary, which miscounts current Claude models. The `@anthropic-ai/tokenizer` dependency is removed. Provider-reported usage is unaffected; only local estimates change, such as compaction token counts and the `/usage` breakdown.
