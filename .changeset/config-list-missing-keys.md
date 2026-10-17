---
"@nanocollective/nanocoder": patch
---

Fix `nanocoder config list`, `show` and `diff` missing the `autoCommit`, `formatters`, `hooks`, `sandbox` and `lspServers` keys. The effective-config resolver still used the block list from before those settings existed, so `config diff` — the natural way to audit what a cloned repo's config will run — hid the very keys that execute shell commands and create commits. `config show` also accepts `nanocoder.notifications` for the preferences-only key (stored under `notifications` in `nanocoder-preferences.json`). Thanks to @Vishesh-Verma-07. Closes #1692.
