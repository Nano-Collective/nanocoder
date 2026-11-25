---
"@nanocollective/nanocoder": patch
---

Checkpoints no longer come back empty when the workspace has a very large number of untracked files. The git output buffer for the modified-files scan is raised to 64 MB, and if the untracked listing still overflows, the tracked changes are snapshotted anyway instead of git being reported as unavailable.
