---
"@nanocollective/nanocoder": patch
---

Prevent `truncateToolResult` and `fetch_url` from cutting UTF-16 surrogate pairs in half, eliminating lone surrogates in truncated output. When a truncation boundary lands between a high and low surrogate, `snapOutsideSurrogate` steps the head boundary back by 1 into the elided middle and steps the tail boundary forward by 1 into the elided middle so astral characters (such as emojis) stay whole or are dropped entirely.
