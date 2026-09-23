---
"@nanocollective/nanocoder": patch
---

`{{args}}` in a custom command now receives the arguments exactly as typed. It was rebuilt from shell-style parsed tokens, so quotes were stripped and an apostrophe opened a quote: `/cmd don't break it` reached the model as `dont break it`. Declared positional parameters still use the parsed tokens.
