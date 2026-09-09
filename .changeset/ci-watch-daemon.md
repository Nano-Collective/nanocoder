---
"@nanocollective/nanocoder": minor
---

Added background CI-watch: the per-project daemon can now poll GitHub Actions for check-run failures on the current branch (`ciWatch.enabled` in preferences) and automatically run a new read-only `verify-ci-investigator` subagent to diagnose the failure, posting the diagnosis as a PR comment when one exists and firing OS notifications on both detection and completion.
