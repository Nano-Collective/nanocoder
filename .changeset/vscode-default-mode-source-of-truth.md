---
"@nanocollective/nanocoder": patch
---

New VS Code chat sessions and ACP sessions now start in the `defaultMode` set in `agents.config.json`, including one set from the extension's Settings tab. The ACP agent used to start every session in `auto-accept` unless `--mode` was passed, and the extension then forced the `nanocoder.mode` setting on top, whose built-in default was also `auto-accept`, so `defaultMode` never took effect. The agent now reads `defaultMode` when each session starts, after `--mode` and before the `auto-accept` fallback. The extension only applies `nanocoder.mode` when you have actually set it, at user, workspace or folder level, and the setting no longer has a default. The mode selector still writes `nanocoder.mode`, so a mode picked there keeps overriding `defaultMode` until you clear the setting. Closes #1722.
