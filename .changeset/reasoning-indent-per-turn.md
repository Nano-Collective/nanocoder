---
"@nanocollective/nanocoder": patch
---

Compact tool summaries ("Ran 2 commands", "Made 3 edits") no longer stay indented for the rest of the session after the first response that included reasoning. They are indented beneath a Thought only when the latest turn actually had one, so after switching to a non-thinking model they render flat again.
