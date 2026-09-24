---
"@nanocollective/nanocoder": patch
---

Made the three "ask the user" queues abort-aware, so a cancelled turn no longer strands its callers. The queue only advances when a human answers, so anything parked on an approval, confirmation or question when its turn died waited there forever, and the prompt for that dead turn stayed on screen for the user to answer on its behalf. `tool-executor` starts a batch of subagents and joins them with `Promise.allSettled`, so a single stranded subagent kept the whole turn open - #1156 fixed the overwriting resolver but noted this await was still not abort-aware, and it was the remaining half.

`signal()` now takes the turn's `AbortSignal`, passed by the subagent executor, the conversation loop's tool confirmation, and the repeated-tool-call question. An aborted request leaves the queue and settles with the same safe default each slot already used when no handler is installed at all: both approval slots deny, so cancelling a turn can never be a route to approving a tool nobody was shown. Removing the head advances the display to the next request; removing one from the middle leaves the screen alone and closes the gap. A request that was already answered is untouched by a later abort, and a signal that is already aborted never puts a prompt on screen in the first place.
