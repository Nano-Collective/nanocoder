---
"@nanocollective/nanocoder": minor
---

File tools now resolve relative paths against the shell's current working directory, and `cd` in bash persists across commands — so relative reads and edits work after moving into a subdirectory or worktree. File tools also accept absolute paths that point inside the project, and can still reach the project root or a sibling worktree after `cd`-ing into a subdirectory.
