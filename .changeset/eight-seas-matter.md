---
'@nanocollective/nanocoder': patch
---

Defer ink and @/app loading in the CLI entry point until the interactive TUI branch, so --acp, --plain and auth paths no longer pay the Ink/App module-graph cost at startup.
