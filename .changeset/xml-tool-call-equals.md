---
"@nanocollective/nanocoder": patch
---

Keep XML tool calls with `=` in argument values instead of dropping bash assignments or code edits. Preserve tool-call examples inside JSON, function-tag, and XML arguments, including template braces and fenced markdown, without executing them or erasing their content. Malformed attribute-style tags in the call structure are still rejected. Closes #1630.
