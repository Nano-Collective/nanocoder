---
"@nanocollective/nanocoder": minor
---

Removed the OrcaRouter, API Route, FutureInfra and Cheaper Inference provider templates from the setup wizard, along with their docs pages. Providers you already configured keep working, since they are ordinary OpenAI-compatible entries in `agents.config.json`; OrcaRouter requests no longer send the OpenRouter-style `HTTP-Referer` / `X-Title` attribution headers. To add one of these services now, pick the **Custom Provider** template (any OpenAI-compatible API) and enter its base URL and API key.
