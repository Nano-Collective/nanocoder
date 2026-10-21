---
"@nanocollective/nanocoder": patch
---

Fix `git_log` ignoring its `branch` argument. It always returned the commits of the checked-out branch while labelling them with the requested one, so asking for the `feature` branch from `main` showed `main`'s history under a `feature` header. The branch is now passed to `git log`, and a branch value starting with `-` is rejected so it can't be read as a git option. Closes #1587.
