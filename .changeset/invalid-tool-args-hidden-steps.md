---
'@nanocollective/nanocoder': patch
---

A tool call whose arguments aren't valid JSON, for example one cut off at the output-token limit, no longer makes up to 10 hidden provider requests. The AI SDK answered such a call itself and asked the model again, up to 10 times inside one model call, so those requests were missing from `steps` and `usage` in `nanocoder run --json`, and the retry limits only applied after each hidden batch. The call now comes back to the agent loop after one request. It isn't run or offered for approval, the model is told its arguments weren't valid JSON so it can try again, and the call counts toward `nanocoder.retries.maxRepeatedToolCalls` like a call to an unknown tool. The broken text is no longer replayed to the provider as a double-encoded string. Closes #1855.
