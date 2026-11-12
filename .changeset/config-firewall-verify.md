---
"@nanocollective/nanocoder": patch
---

Fix `nanocoder config list`, `show` and `diff` leaving out the `firewall` and `verify` blocks of `agents.config.json`. Both are read by the app (the mutation firewall and the daemon's CI trust level), so a project file that tightened or loosened them was invisible to the command meant to audit it. The firewall rows show the settings the firewall actually applies, including `enabled` derived from `mode`.
