---
"@nanocollective/nanocoder": patch
---

`write_file` now refuses a whole-file overwrite when the file changed after the agent read it, including while approval was pending.
