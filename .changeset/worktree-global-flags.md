---
"@nanocollective/nanocoder": patch
---

`nanocoder worktree 42 --provider X` and `nanocoder worktree 42 --mode plan` now work. The worktree command accepted only a bare PR number and failed with a usage error when any option followed it. Global options after the PR number are now validated like they are for other commands, with typo suggestions, and apply to the session started in the new worktree.
