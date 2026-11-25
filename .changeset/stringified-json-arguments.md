---
"@nanocollective/nanocoder": patch
---

A JSON tool call whose arguments are a stringified object is reported as a malformed tool call, so the model can correct it. Escaped quotes in that string used to hide the call, and the turn ended on the raw JSON instead of running anything. Fixes #2318.
