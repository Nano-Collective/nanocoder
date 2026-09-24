---
"@nanocollective/nanocoder": patch
---

Tool approval prompts now answer exactly once. The approval queue resolves its head on every answer, so a second answer from an already-settled prompt would have consumed the next queued request and resolved it unseen — approving a tool the user was never shown. The prompt now ignores any answer after the first and resets when a new request arrives.
