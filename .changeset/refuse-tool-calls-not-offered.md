---
"@nanocollective/nanocoder": patch
---

Fixed plan mode running tools it never offered. The mode only decided which tools the model was shown, so a model that named a hidden tool anyway (for example `write_file` or `execute_bash` in plan mode) reached the approval step, where an `alwaysAllow` entry or a client's Allow let it run. The interactive loop, `nanocoder run` and ACP now refuse any registered tool that was not offered for the turn - by mode, tune profile or disabled list - and tell the model it is not available. This also covers MCP tools that plan mode hides because they are not read-only.
