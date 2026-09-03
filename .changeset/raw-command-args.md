---
"@nanocollective/nanocoder": patch
---

Fixed `{{args}}` in custom commands without declared parameters so it receives the raw command arguments instead of an empty string. Closes #1035.
