---
'@nanocollective/nanocoder': patch
---

ACP custom commands fill `{{args}}` and named parameters from the text after the command name, the same way the CLI does. The model no longer sees the placeholder or the raw slash line above the body. Closes #1639.
