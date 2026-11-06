---
"@nanocollective/nanocoder": patch
---

Removed the leftover `__xml_validation_error__` handling, since nothing creates that marker any more and XML the parser rejects already goes through the malformed tool-call retry. Closes #1300. `processToolUse` now returns an error result for an unknown tool or an uninitialized tool registry instead of throwing. Closes #1303.
