---
"@nanocollective/nanocoder": patch
---

Fixed voice input submitting a turn while a modal was open. Ctrl+G push-to-talk and hands-free voice now follow the same gate as the prompt box, so they no longer send a transcript behind `/settings`, the plan review bar, the architect review gate or a live component that captures input.
