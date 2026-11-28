---
"@nanocollective/nanocoder": patch
---

`write_file` now refuses a whole-file overwrite when the file changed after the agent read it, including while approval was pending. After `file_op` deletes or moves a file the agent had read, the first write is rejected as stale; any replacement at that path must be read before overwrite, while an absent path can be recreated after the warning.
