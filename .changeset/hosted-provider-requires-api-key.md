---
"@nanocollective/nanocoder": patch
---

A hosted provider configured without an API key is now rejected at startup with `API key required for hosted providers`, instead of starting and failing with a 401 on the first request. The `dummy-key` placeholder is only filled in for local servers such as Ollama and LM Studio, which still start without a key. Closes #2337.
