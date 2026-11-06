---
"@nanocollective/nanocoder": minor
---

Added a first-class provider template for OpenLLM, a local gateway that serves your subscription accounts and API keys through one OpenAI-compatible endpoint, to the `/settings providers` wizard. Selecting it fills in the local daemon URL (`http://127.0.0.1:8787/v1`) and the `ultra` model alias. When the local daemon is not signed in, Nanocoder now surfaces `openllm login` instead of a generic invalid-API-key message.
