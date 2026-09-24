---
"@nanocollective/nanocoder": patch
---

The provider settings `promptCaching` and `maxRetries` in `agents.config.json` now take effect. Both were documented but dropped when provider entries were loaded, so `"promptCaching": false` still sent Anthropic cache breakpoints and a custom `maxRetries` always fell back to 2.
