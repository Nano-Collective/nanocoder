---
"@nanocollective/nanocoder": patch
---

An install with a missing `package.json` no longer posts "Failed to read current version" to the chat on startup, which also pushed the welcome screen away. The update check now uses the shared version helper and skips itself when the version is unknown, and the banner reads "(version unknown)" instead of "vunknown".
