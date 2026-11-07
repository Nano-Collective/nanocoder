---
"@nanocollective/nanocoder": patch
---

`execute_bash` now blocks recursive force deletes of the directory that holds every user's home, not just the home directory itself. `rm -rf ~/..`, `rm -rf ~/../..`, `rm -rf $HOME/..`, `rm -rf ${HOME}/..`, `rm -rf /home/user/..` and `rm -rf /Users/alice/..` are refused, along with `rm -rf /home` and `rm -rf /Users`. Home references are expanded and `..` segments resolved before the guard compares, so the parent of a non-standard home directory is covered too. Ordinary cleanups such as `rm -rf ~/project` and `rm -rf /tmp/build` stay allowed. Closes #1990.
