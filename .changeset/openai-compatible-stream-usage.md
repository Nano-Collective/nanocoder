---
"@nanocollective/nanocoder": patch
---

Request streaming usage metrics by default (`includeUsage: true`) for OpenAI-compatible providers (such as Ollama, LM Studio, and vLLM), so token metrics are correctly emitted and displayed during streamed sessions. Also adds support for configuring `includeUsage: false` on the provider to opt out when using non-standard reverse proxies. Fixes #1658.

If `includeUsage` is not set and an endpoint rejects `stream_options` with a 400 or 422, the request is retried once without it, a warning points at `includeUsage: false`, and it stays off for that provider for the rest of the session.
