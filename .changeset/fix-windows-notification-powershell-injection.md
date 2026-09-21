---
"@nanocollective/nanocoder": patch
---

Hardened Windows native notifications. Notification title and message are no longer interpolated into the PowerShell script; they are passed out-of-band as environment variables and read by a static script. Fixes rendering and parsing edge cases with backticks, quotes and other special characters. Closes #1138.

