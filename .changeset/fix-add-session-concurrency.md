---
'@nanocollective/nanocoder': patch
---

Use `atomicWriteFileSync` for `writeUsageData` to prevent partial or corrupted file visibility.
