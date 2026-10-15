---
"@nanocollective/nanocoder": minor
---

The VS Code chat panel now queues follow-up prompts submitted while a turn is still running, instead of firing a second overlapping ACP request (which the agent rejected with "Prompt already in progress") or leaving the thought sitting un-submitted in the composer.
Queued messages appear inline as user bubbles with a Queued badge and a remove button; when the current turn finishes they dequeue in order.
While a turn is running, typing in the composer flips Stop back to Send so clicking it queues the follow-up (Escape or an empty-composer Stop still cancels). The webview parks that follow-up locally and only forwards it after the in-flight ACP `prompt()` settles — posting it immediately was what produced the "RequestError: Internal error" toast.
Stop / Escape (and New Chat) discard the whole queue so cancelling a runaway agent does not immediately start the next waiting prompt.
