---
"@nanocollective/nanocoder": patch
---

Fix `/review` on a branch showing commits that were already merged upstream. A branch review was diffed against local `main`, which goes stale, and in a fork even `origin/main` is only the fork's copy. It now diffs against the upstream base: the pull request's base branch when one exists, otherwise the parent repository's default branch, and local `main` only as a last resort. When a fork's parent is not a configured remote, the review says so and prints the `git remote add upstream` command to compare against it.
