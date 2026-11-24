---
"@nanocollective/nanocoder": patch
---

A hosted provider configured without any credentials is now rejected at startup, with a message that says to set `apiKey` (any non-empty value if the server doesn't check one) or authentication `headers`, instead of starting and failing with a 401 on the first request. A provider that authenticates through custom `headers` keeps working without an API key; `organizationId` alone is not a credential. The `dummy-key` placeholder is only filled in for local servers such as Ollama and LM Studio, which still start without a key, and the Custom Provider wizard now says the API key is optional only for local servers. Closes #2337.
