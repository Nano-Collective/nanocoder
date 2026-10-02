---
"@nanocollective/nanocoder": patch
---

Added a next-command suggestion after turns that edit files. When a turn makes a successful `write_file` or `string_replace` edit, the empty prompt now suggests a relevant follow-up: `/commit` when changes are already staged, otherwise `/checkpoint create`. The suggestion is only placeholder text — typing replaces it, Tab inserts the command, Esc dismisses it, and sending a message clears it — and a slash command finishing (the suggested one included) does not bring it back. Closes #1317.
