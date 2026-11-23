---
"@nanocollective/nanocoder": patch
---

Local models no longer show a cost in the usage footer or `/usage`. Pricing is now looked up by exact model id only, so a local Ollama or LM Studio model such as `llama3` or `qwen3-coder` is no longer billed at the rate of a hosted model with a similar name. Context-limit lookups still match by name. Closes #2338.
