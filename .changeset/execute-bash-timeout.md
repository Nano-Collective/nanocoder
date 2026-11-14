---
"@nanocollective/nanocoder": patch
---

`execute_bash` takes an optional `timeout_seconds`, so a long build, test suite or install is no longer killed at the 2 minute default and a command that should return quickly can be cut short. The value is clamped to 1–300 seconds (the existing 5 minute ceiling), 120 seconds stays the default, and the approval preview shows a non-default limit. A killed command now reports the limit that was applied as `Command timed out after N seconds`, so the model can tell whether raising it is worth another run. Applies to the interactive TUI as well as plain, headless and ACP runs.
