---
"@nanocollective/nanocoder": minor
---

Added a first-class provider template for Cheaper Inference, an OpenAI-compatible gateway, to the `/settings providers` wizard. Selecting it fills in the base URL (`https://api.cheaperinference.com/v1`) so only an API key and a model name are needed, and the wizard can fetch the account's model list over the standard `/models` endpoint.
