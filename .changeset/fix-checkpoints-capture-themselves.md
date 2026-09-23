---
"@nanocollective/nanocoder": patch
---

Checkpoints no longer snapshot nanocoder's own state. In a repo that doesn't gitignore `.nanocoder/`, every checkpoint captured the earlier checkpoints and the action timeline, so each one grew (0, 2, 6, 14, 30 files) until the 50-file cap crowded out your real changes, and restoring one wrote stale checkpoint data back over the live store. User content under `.nanocoder/` (commands, agents, tools, skills) is still captured.
