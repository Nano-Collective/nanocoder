---
'@nanocollective/nanocoder': patch
---

Fail initialization when a provider selected with `--provider` (including `nanocoder --acp --provider`) cannot be created, instead of silently sending prompts to another configured provider. Switching provider over ACP now fails the same way and leaves the session on its current provider; before, the editor was told the switch succeeded while requests went to whichever other provider happened to initialize. The saved and default provider keep their existing fallback.
