---
"@nanocollective/nanocoder": patch
---

The directory trust fingerprint now also covers the project `.env`, the `agents.config.json` settings that relax confirmations (`alwaysAllow`, `defaultMode`, `sandbox`, `verify.trustLevel`) and project provider `baseUrl`s, and the trust prompt lists them. Changing any of these asks for trust again. Folders without them keep the fingerprint they already had.
