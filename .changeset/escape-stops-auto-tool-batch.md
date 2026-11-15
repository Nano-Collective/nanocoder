---
"@nanocollective/nanocoder": patch
---

Pressing Escape now stops the rest of an auto-approved tool batch. Before, cancelling during one tool (say a long `execute_bash`) still let the edits queued behind it run, so `write_file` or `string_replace` could change files after you had cancelled. Tools that did not run get a cancellation result so the saved history stays valid. A reply whose tool calls arrive just after you press Escape, or while auto-compaction runs, also no longer executes them, and a tool approved at the same moment as a cancel is treated as declined.
