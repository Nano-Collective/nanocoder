---
'@nanocollective/nanocoder': patch
---

Nanocoder now rejects unknown top-level flags and commands before starting the app, suggesting the intended spelling when possible. This prevents a typo such as `--mdoe` from silently leaving `run` in its default auto-accept mode. Closes #1736.

An option typed before a subcommand, as in `nanocoder --trust-directory daemon start`, gets a hint to put the command first instead of an unknown-command error.
