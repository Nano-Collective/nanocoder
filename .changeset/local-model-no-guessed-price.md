---
"@nanocollective/nanocoder": patch
---

Local models no longer show a cost in the usage footer, `/review`, ACP, `/usage` or the lifetime `/stats`. Pricing is skipped when the active provider's base URL is local (Ollama, LM Studio), even when a hosted provider on models.dev lists the same model id, such as `gpt-oss:20b`. Pricing lookups also no longer borrow the price of a similarly named model: they match the model id exactly, ignoring case. Context-limit lookups still match by name. Closes #2338.
