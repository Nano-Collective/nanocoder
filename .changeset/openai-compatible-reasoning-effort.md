---
"@nanocollective/nanocoder": minor
---

Forward explicitly configured `tune.modelParameters.reasoningEffort` values to generic OpenAI-compatible providers as `reasoning_effort`. The field remains absent when it is not configured, so models that reject reasoning controls are unaffected. Closes #1361.
