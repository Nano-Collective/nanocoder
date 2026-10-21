---
"@nanocollective/nanocoder": patch
---

Fix the live streaming preview losing its bound when a short line is followed by one huge line. `computeStreamingTail` snapped its slice start back to the nearest preceding newline to avoid a partial leading line, but that search had no lower bound: a message like `Intro\n` followed by a minified bundle or a big JSON blob snapped the start back past the whole bound, so the tail became the entire message and every streaming update re-wrapped all of it. The snap-back now only applies when the newline is within one line's width of the raw start, accepting a partial leading line rather than discarding the bound.
