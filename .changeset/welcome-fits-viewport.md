---
"@nanocollective/nanocoder": patch
---

The welcome screen now fits a standard 80x24 terminal. It sized itself against the whole terminal height, but fullscreen mode clips at the chat viewport — the terminal minus the input footer — so the last menu item and the tip were cut off with no hint anything was missing. The banner is now given the rows it actually has, and drops the block wordmark before the menu and tip when they are tight. Closes #1330.
