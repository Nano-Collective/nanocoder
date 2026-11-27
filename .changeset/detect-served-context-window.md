---
"@nanocollective/nanocoder": patch
---

Nanocoder now asks Ollama (an explicit `num_ctx` from `/api/show`, else the loaded model's `context_length` from `/api/ps`), llama.cpp (`/props`) and vLLM (`/v1/models`) which context window they are actually serving and uses that for the context percentage and auto-compaction, instead of the models.dev catalogue value. `--context-max`, `contextWindow(s)` and `NANOCODER_CONTEXT_LIMIT` still take precedence, and any probe failure falls back to the previous behaviour. An unrecognised local server is probed for all kinds concurrently under one 2 second cap. Closes #2166.
