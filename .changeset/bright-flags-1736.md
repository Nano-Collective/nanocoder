---
'@nanocollective/nanocoder': patch
---

Nanocoder now rejects unknown top-level flags and commands before starting the app, suggesting the intended spelling when possible. This prevents a typo such as `--mdoe` from silently leaving `run` in its default auto-accept mode. Closes #1736.
