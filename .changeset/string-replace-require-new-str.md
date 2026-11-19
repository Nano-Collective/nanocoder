---
"@nanocollective/nanocoder": patch
---

`string_replace` now rejects a call with a missing or non-string `new_str` before touching the file. Previously the literal text `undefined` was written into the file in place of `old_str`, and on CRLF files the validator reported a misleading "Error reading file" message. An empty `new_str` still deletes the matched text.
