---
"@nanocollective/nanocoder": minor
---

Added a per-response token usage and estimated cost indicator. Every assistant message in the CLI now ends with a subtle gray footer showing the provider-reported token count and estimated cost (e.g. `Tokens: 4.2k | ~$0.01`), computed from models.dev pricing; the cost segment is omitted for local/free models and the footer falls back to the previous client-side estimate when the provider reports no usage. The VS Code extension shows the same indicator under each finished response, fed by the per-turn usage now returned on the ACP prompt response. Closes #756.
