---
"@nanocollective/nanocoder": minor
---

The system prompt now includes a short git snapshot taken at session start when the project is a git repository: current branch and default branch, upstream ahead/behind counts, a `git status` summary with up to 10 changed paths, and the last 5 commit subjects. The model no longer has to spend a turn on `git status` and `git log` before it knows about uncommitted work. Only local, read-only git commands run, each with a short timeout, and the block is skipped under the `nano` tool profile. Turn it off with `nanocoder.gitContext: false`. Closes #2276.
