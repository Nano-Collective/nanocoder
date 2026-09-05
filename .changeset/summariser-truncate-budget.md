---
'@nanocollective/nanocoder': patch
---

Fixed the conversation summariser's truncation overshooting its character budget. The `... [truncated N chars]` notice was appended *after* slicing to the limit, so every truncated system prompt, tool-call argument, and tool result sent to the summariser ran over budget by the width of that notice. The kept length is now solved for so the notice fits inside the limit, and a budget too small for the notice at all falls back to a plain slice. Thanks to @aashu2006. Closes #1135.
