---
"@nanocollective/nanocoder": minor
---

Added `nanocoder daemon start --trust <auto-fix|full-commit>`, letting the CI-watch daemon's `verify-ci-investigator` subagent actually fix a detected failure instead of only diagnosing it: `auto-fix` implements and commits a fix in an isolated `git worktree`, then opens a draft PR for human review; `full-commit` pushes the fix directly to the failing branch and requires a one-time confirmation warning per project. Trust level and CI-watch poll cadence can now also be set project-wide via `agents.config.json`'s new `verify` block, taking precedence over the existing per-user preferences.
