---
"@nanocollective/nanocoder": minor
---

Added Reasoning Effort to the `/tune` modal, under **Model Parameters**. The setting was previously reachable only by editing `agents.config.json` by hand, so forwarding it to OpenAI-compatible providers was effectively undiscoverable from the UI. It cycles `minimal → low → medium → high` and then back to unset, matching the numeric parameters' wrap-to-default behaviour; unset sends no reasoning field, which is the right choice for models that reject it. The tooltip states which mechanism each provider uses, since the same value becomes `reasoning_effort`, `reasoning.effort`, or `providerOptions.openai` depending on the active provider. OpenRouter's `xhigh` and `none` remain provider-config-only, as they are not shared with the other providers.
