---
"@nanocollective/nanocoder": patch
---

Reject context limits that become 0 or Infinity once scaled and rounded: `--context-max 0.1` used to be accepted as a limit of 0, and a very long number with a `k` suffix as Infinity. Both are now refused like any other invalid value. Closes #1590.
