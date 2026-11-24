---
"@nanocollective/nanocoder": patch
---

`<think>` blocks are no longer stripped from inside tool-call arguments, so a `write_file` whose content contains the tag keeps its text, and prose that merely mentions `<think>` is no longer cut off at the mention.
