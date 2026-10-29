---
"@nanocollective/nanocoder": minor
---

Added a `/whoami` command that shows the active provider, model, base URL, and API key. The key is masked so only its first 3 and last 4 characters show (shorter keys are fully hidden), which makes it safe to screenshot when debugging a failing provider setup. Providers that sign in with OAuth (ChatGPT, GitHub Copilot) show the login method instead. Closes #937.
