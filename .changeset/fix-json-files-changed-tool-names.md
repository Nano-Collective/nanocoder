---
"@nanocollective/nanocoder": patch
---

Fixed `filesChanged` being empty or incomplete in the `--plain --json` run report. The mutating-tool list matched `write_to_file`, `create_file` and `edit_file`, none of which are real tool names, so only `string_replace` edits were ever recorded - runs where the model used `write_file` or `diff_edit` reported no changed files at all. The list now matches the registered names in `source/tools/file-ops/`. The same phantom names were also driving two unreachable branches in the conversation-state summariser, which now recognises `string_replace` and `diff_edit`.
