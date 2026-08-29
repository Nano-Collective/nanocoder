---
"@nanocollective/nanocoder": minor
---

Added Anthropic prompt caching. The system prompt, tool schemas, and conversation history are now marked with cache breakpoints, so multi-turn sessions read the stable prefix back out of cache instead of paying full price for it every turn. Cost reporting is cache-aware throughout: `/usage` and the per-response indicator price cache reads and writes at their own rates instead of billing every cache hit at the full input rate, and the per-response indicator surfaces the cached token count alongside the total. Opt out with `"promptCaching": false` on the provider config. Closes #888.
