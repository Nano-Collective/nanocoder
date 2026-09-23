---
"@nanocollective/nanocoder": patch
---

Fix macOS native notifications when title or message contains newlines, quotes, backslashes, or Unicode characters by passing arguments out-of-band to `osascript`. Closes #1139.
