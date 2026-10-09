---
"@nanocollective/nanocoder": patch
---

Surface config, hook, formatter, and plugin warnings to `stderr` in `run` / `--plain` mode and include them in `--json` reports as `warnings[]`. Also preserve underlying JSON syntax and parse diagnostics when loading `agents.config.json` rather than collapsing them into "No providers configured". Closes #1652.
