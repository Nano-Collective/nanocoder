---
"@nanocollective/nanocoder": patch
---

Request streaming usage metrics by default (`includeUsage: true`) for OpenAI-compatible providers (such as Ollama, LM Studio, and vLLM), so token metrics are correctly emitted and displayed during streamed sessions. Also adds support for configuring `includeUsage: false` on the provider to opt out when using non-standard reverse proxies. Fixes #1658.
