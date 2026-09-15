---
'@nanocollective/nanocoder': patch
---

Long tool output no longer floods the transcript. `write_file`, `string_replace`, `diff_edit`, and tools without a formatter (such as MCP tools) now show at most 20 lines followed by `… (+N more lines · /expand n)`, the same cap `execute_bash` output already had. When the cap cuts into a diff, the note says how many of the hidden lines are edits (`+N more lines, K changed`), and a `write_file` overwrite diff skips long unchanged stretches so an edit deep in a large file is still shown. The new `/expand <n>` command prints a single tool result in full, including one folded into a compact tally, and `/expand` on its own lists recent results, so reading one result no longer means switching every result to expanded view with Ctrl+O. Closes #1289.
