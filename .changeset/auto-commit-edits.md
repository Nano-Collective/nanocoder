---
"@nanocollective/nanocoder": minor
---

Add `nanocoder.autoCommit` (#1482). When set to `true` in `agents.config.json`, every successful agent file edit (`write_file`, `string_replace`, `diff_edit`) is committed on its own, with a Conventional Commit message the current model writes from that file's diff (the `/commit` prompt), falling back to `chore: update <path>` if the model call fails. Only the edited file is committed, so the user's own staged and unstaged work is never swept in. Auto-commit is skipped outside a git repository, for ignored files, for no-op edits, and while a merge, rebase, cherry-pick or revert is in progress; a failed commit is logged as a warning and never fails the tool call. Off by default.
