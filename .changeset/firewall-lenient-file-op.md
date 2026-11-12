---
"@nanocollective/nanocoder": patch
---

Fixed three gaps in the mutation firewall. In `lenient` mode the violations were computed and then thrown away, so lenient did nothing; they are now appended to the tool result, so the model sees them, and shown as a warning in the chat. `protectedPatterns` were matched against the process working directory rather than the session's, so a pattern could miss or wrongly match after a `cd` in bash or in an ACP session; relative paths now resolve the way the file tools resolve them, and patterns match from the project root. `file_op` `delete`, `move` and `copy` skipped the firewall entirely; they now respect `protectedPatterns`.
