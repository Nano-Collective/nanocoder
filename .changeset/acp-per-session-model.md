---
"@nanocollective/nanocoder": minor
---

ACP sessions now keep their own provider and model. Changing them with `session/set_config_option` affects only that session (a running turn finishes on the model it started with), its subagents use the model it is on, the config options returned for a session are its own, and saved sessions record their own provider and model. `session/resume` and `session/load` restore the saved provider and model when they are still available, and otherwise stay on the default and report the saved choice in `_meta["nanocoder/modelFallback"]`. The agent advertises `agentCapabilities._meta.nanocoder.perSessionModel`.
