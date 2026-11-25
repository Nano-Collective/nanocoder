---
"@nanocollective/nanocoder": patch
---

When the model calls a tool that does not exist, the "Available tools are: …" hint now lists only the tools offered in the current turn. It used to list every registered tool, including ones the mode, tune profile or disabled list hides and scoped skill tools, so a model that picked one from the hint was refused again with "not available in the current mode".
