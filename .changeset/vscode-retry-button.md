---
"@nanocollective/nanocoder": minor
---

Added a "Retry" button to AI responses in the VS Code chat panel. Reorganised the assistant turn footer so the action buttons (Retry, Copy) sit together with the timestamp, and resubmitting a retried prompt no longer creates a duplicate user message bubble.

Behind the scenes, the webview now calls a new `retryTurn` extMethod on the ACP agent. The method truncates the session message history at the matching user turn and drops any action-timeline checkpoints captured inside that turn, so reverting a checkpoint can no longer rewind past the retried turn. The `pendingUserMessageText` lifecycle was tightened so user bubbles reconstruct correctly when resuming or switching between history sessions.
