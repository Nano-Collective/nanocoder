---
'@nanocollective/nanocoder': patch
---

A plugin whose import never finishes no longer freezes startup. It is skipped after 30 seconds, and the plugins after it still load. Closes #1656.
