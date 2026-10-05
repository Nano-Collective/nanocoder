---
"@nanocollective/nanocoder": patch
---

Fixed the sub-agent transcript appending "..." to every tool result. The view sliced each result to 100 characters and added the ellipsis unconditionally, so a short result like `OK` rendered as `OK...` and implied output that was never truncated. The ellipsis now appears only when the content is actually past the limit, matching the guarded pattern in the git-commit tool card. Closes #1408.
