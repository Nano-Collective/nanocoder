---
"@nanocollective/nanocoder": patch
---

Deduplicate parse errors when loading an invalid `agents.config.json`. A syntax error in a config file is now reported once with a clear message indicating the file was skipped, instead of repeating across each individual config section. Closes #2250.
