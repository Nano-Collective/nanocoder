---
"@nanocollective/nanocoder": patch
---

Fix `execute_bash` on Windows so a `cd` in one command updates the session cwd used by file tools, matching macOS and Linux. Closes #2239.
