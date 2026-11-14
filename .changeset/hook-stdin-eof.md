---
"@nanocollective/nanocoder": patch
---

Lifecycle hooks and formatters no longer hang until their timeout when the command reads stdin. Their stdin is now closed immediately, so `cat`, `jq` and similar commands see EOF instead of waiting for input that never arrives.
