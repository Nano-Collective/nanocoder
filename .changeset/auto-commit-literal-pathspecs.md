---
"@nanocollective/nanocoder": patch
---

Fix `nanocoder.autoCommit` committing other files when the edited file's name looks like a git glob. The path was passed to `git add`, `git diff --cached` and `git commit` as a pathspec, so an agent edit to `[ab].txt` also matched `a.txt` and `b.txt` and swept the user's uncommitted edits to them into the agent's commit. Auto-commit now runs git with `--literal-pathspecs`, so only the edited file is committed. Closes #1654.
