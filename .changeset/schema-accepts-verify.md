---
"@nanocollective/nanocoder": patch
---

The `agents.config.json` JSON schema now accepts `nanocoder.verify` (`trustLevel`, `pollIntervalMs`, `maxPollIntervalMs`). The loader already read it and the docs described it, but the schema rejected it, so editors flagged a working, documented key as an error.
