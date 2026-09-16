---
"@nanocollective/nanocoder": patch
---

Fix `createErrorInfo` misclassifying validation errors as network errors. A validation message containing the word "connection" (or "fetch") was also flagged `isNetworkError` because the network check used loose `.includes()` substring matching. Validation now takes strict precedence over the network/timeout substring heuristics. Thanks to @MsfPablo. Closes #1136.
