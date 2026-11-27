---
"@nanocollective/nanocoder": minor
---

Added `nanocoder swarm "<goal>"`, which splits a goal into tasks with separate file scopes, runs one headless agent per task in its own Git worktree, and combines their changes into patches after checking each stayed in scope. Patches are only saved by default (`--swarm-mode review`), applied after confirmation (`apply`) or applied automatically (`yolo`). `run` also gains `--restricted-scope` and `--telemetry`. Tasks run in parallel only: there is no serial fallback for goals that cannot be split. Part of #792.
