---
"@nanocollective/nanocoder": patch
---

ACP sessions now apply the `nanocoder.retries` caps the `--plain` shell already does. A model that repeats the same tool call, replies with nothing, or emits malformed text tool calls is nudged and then stopped with a note in the chat, rather than using up to 200 model requests on one prompt. A malformed tool call is now fed back for a retry, where before it silently ended the turn. A reply cut off at the output-token limit is asked to continue, where before the fragment was treated as the final answer.
