---
"@nanocollective/nanocoder": patch
---

Added a keyboard shortcuts overlay. Pressing `?` in an empty prompt now opens a legend of the chat input's shortcuts (submit, new line, history, readline editing, image attachments, mode cycling, compact output, reasoning traces, task list, subagent attach, cancel, exit) instead of typing a literal question mark; `?` or Esc closes it. `?` typed anywhere after the first character still inserts normally, and `/help` now points to the overlay. Closes #1315.
