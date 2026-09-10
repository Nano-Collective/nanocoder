---
"@nanocollective/nanocoder": patch
---

Hardened the VS Code action timeline: it no longer snapshots its own before-images, skips a checkpoint rather than recording a wrong one when the workspace scan is truncated, leaves binary files alone, reverts a whole assistant turn at once, validates paths read back from the timeline index, and keeps the chat thread on screen when a revert is refused.
