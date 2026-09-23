---
"@nanocollective/nanocoder": patch
---

Fixed the `run` mode boot line never showing the provider, model or mode. It pinned those values on the first render, before initialization had set them, so the line showed only the workspace, and on a narrow terminal it rendered nothing at all.
