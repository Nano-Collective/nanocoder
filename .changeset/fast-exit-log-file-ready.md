---
"@nanocollective/nanocoder": patch
---

Commands that finish straight after starting, such as `nanocoder verify --help` or `nanocoder daemon status`, no longer exit with code 1 after succeeding. The log file was opened asynchronously, and exiting before it was ready made the logger's exit hook throw "sonic boom is not ready yet", which was reported as a fatal error. The log file is now opened before logging starts.
