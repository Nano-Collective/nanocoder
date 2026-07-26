---
"@nanocollective/nanocoder": patch
---

Fixed Ctrl+S not cycling between multiple parallel subagent sessions. The attached-session transcript renders through Ink's append-only `<Static>`, so switching agents never printed the new agent's messages; the view is now remounted per agent with a terminal wipe (same treatment as /clear), and rapid Ctrl+S presses cycle reliably.
