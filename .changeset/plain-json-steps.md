---
'@nanocollective/nanocoder': patch
---

`nanocoder --plain --json run` reports now include `steps`, the number of model round-trips in the run (retried turns included). It differs from the length of `toolCalls`, since one step can make zero or several tool calls, and it is `0` when the run stops before the model is called. This gives the agent evaluation harness in #1197 a step count to measure.
