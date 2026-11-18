---
"@nanocollective/nanocoder": patch
---

`/review` and `/gh-pr-worktree` now recognise the same GitHub remote URLs. `/review` also accepts `http://github.com/...` remotes. `/gh-pr-worktree` also accepts `www.github.com`, `git://` and `ssh://` URLs without a `git@` user, URLs with an SSH port, and scp-style remotes with any user name.
