---
"@nanocollective/nanocoder": patch
---

The `execute_bash` delete guard now follows a `cd` or `pushd` earlier in the same command. `cd ~ && rm -rf ..` was allowed because `..` was read without knowing the working directory; it is now resolved against the directory the command moved to, so it is blocked like `rm -rf ~/..`. Relative cleanups after a `cd` into a project (`cd ~/project && rm -rf node_modules`) stay allowed.
