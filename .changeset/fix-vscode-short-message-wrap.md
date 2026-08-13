---
"@nanocollective/nanocoder": patch
---

Fixed short user messages wrapping mid-word in the VS Code extension chat. The message bubble carried `max-w-[85%]` on top of the turn wrapper's own `max-w-[85%]`, so the inner percentage resolved against the wrapper's shrink-to-fit width and squeezed each bubble to 85% of its own content - combined with `break-words`, "hey" rendered as "he" / "y". The bubble now uses `max-w-full` and the cap lives only on the wrapper.
