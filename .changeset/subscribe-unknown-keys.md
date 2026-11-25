---
"@nanocollective/nanocoder": patch
---

A `subscribe:` entry with an unknown key, such as `path:` instead of `paths:`, is now reported with a "Did you mean" hint instead of being silently dropped. Before, the typo removed the filter and the trigger fired on every file. Closes #2247.
