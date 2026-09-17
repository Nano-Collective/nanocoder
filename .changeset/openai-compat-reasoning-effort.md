---
"@nanocollective/nanocoder": minor
---

Forward `tune.modelParameters.reasoningEffort` to OpenAI-compatible providers as the request body field `reasoning_effort`. The setting previously applied only to `chatgpt-codex` and OpenRouter; it now reaches any provider using the default openai-compatible SDK path (DeepSeek, LocalAI, a custom endpoint, and so on) when explicitly configured, and is left out entirely when unset so providers whose models do not accept it are unaffected. Closes #1361.
