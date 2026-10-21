---
'@nanocollective/nanocoder': patch
---

Speed up startup by checking git/gh availability without spawning child processes. Importing the tool registry no longer blocks the first frame with `git --version`, `git rev-parse`, and `gh --version` calls; availability is now resolved lazily from the filesystem when the tool registry is built. Behavior is unchanged: git tools are still offered inside a repository, hidden outside, and `git_pr` still requires the gh CLI. Thanks to @Vishesh-Verma-07. Closes #1819.
