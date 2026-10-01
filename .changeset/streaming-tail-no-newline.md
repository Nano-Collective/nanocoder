---
"@nanocollective/nanocoder": patch
---

Fix the live streaming preview growing unbounded on a response with one very long line and no newlines. `computeStreamingTail` snapped its slice start back to the nearest preceding newline to avoid a partial leading line, but with no newline at all it snapped all the way to 0, discarding the tail bound entirely. It now falls back to the unsnapped tail start instead, accepting one truncated leading line rather than rendering the whole growing message. Closes #1555.
