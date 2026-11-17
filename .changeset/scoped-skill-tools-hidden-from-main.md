---
"@nanocollective/nanocoder": patch
---

A skill bundle's scoped tools can no longer be run by the main conversation. They were already left out of the tools offered to the model, but a call that named one still ran; it is now refused as not available, in the TUI, `--plain` and ACP alike. The bundle's own subagent still has them.
