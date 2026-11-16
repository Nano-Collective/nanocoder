---
"@nanocollective/nanocoder": patch
---

Nanocoder now asks Ollama (`/api/show`), llama.cpp (`/props`) and vLLM (`/v1/models`) which context window they are actually serving and uses that for the context percentage and auto-compaction, instead of the models.dev catalogue value. `--context-max`, `contextWindow(s)` and `NANOCODER_CONTEXT_LIMIT` still take precedence, and any probe failure falls back to the previous behaviour. Closes #2166.
