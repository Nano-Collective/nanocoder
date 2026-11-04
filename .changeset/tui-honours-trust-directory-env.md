---
'@nanocollective/nanocoder': patch
---

The interactive TUI now honours `NANOCODER_TRUST_DIRECTORY=1` the same way `--plain`, ACP and `nanocoder daemon start` do: it skips the directory trust disclaimer and records the folder as trusted, instead of showing the prompt anyway. As before, a project `.env` cannot set this variable, so only your own shell environment can grant trust this way.
