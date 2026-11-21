---
"@nanocollective/nanocoder": patch
---

Fixed native tool support detection so genuine server rejection of native tool parameters can retry with XML tools, while invalid function schemas, function-call arguments, and `tool_choice` validation errors are not misclassified as missing native tool support.
