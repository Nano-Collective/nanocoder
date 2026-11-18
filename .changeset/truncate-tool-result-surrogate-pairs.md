---
"@nanocollective/nanocoder": patch
---

Prevent `truncateToolResult` from cutting UTF-16 surrogate pairs in half, eliminating lone surrogates in truncated output. When a truncation boundary lands between a high and low surrogate, the head boundary steps back by 1 and the tail boundary steps forward by 1, both into the elided middle, so astral characters (such as emojis) stay whole or are dropped entirely.
