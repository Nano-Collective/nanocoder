---
"@nanocollective/nanocoder": patch
---

Add per-provider `fallback` lists: when a provider fails a request with a retryable error (429, 5xx, network) after exhausting its retries, the same request is re-sent to the next fallback provider or model. A one-line notice names the provider that answered, and the primary stays selected for the next turn.
