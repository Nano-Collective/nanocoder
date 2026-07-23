---
"@nanocollective/nanocoder": minor
---

File tools now resolve relative paths against the shell's current working directory, and `cd` in bash persists across commands — so relative reads and edits work after moving into a subdirectory or worktree.
